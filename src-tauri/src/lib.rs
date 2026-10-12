use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::collections::{HashMap, BTreeSet};
use std::path::{Path, PathBuf};
use tauri::{Manager, Emitter, WebviewUrl, WebviewWindowBuilder, RunEvent, WindowEvent};
use tauri_plugin_fs::FsExt;
use serde::{Deserialize, Serialize};
use font_kit::source::SystemSource;

mod ai;

// Store the file path to be opened (from CLI args or file association)
pub struct OpenFileState(pub Mutex<Option<String>>);

// Global registry of open files: file_path -> window_label
pub struct OpenFilesRegistry(pub Mutex<OpenFileRegistryState>);

#[derive(Debug, Default)]
pub struct OpenFileRegistryState {
    files: HashMap<String, FileOwner>,
    reservations: HashMap<String, TargetReservation>,
    frontend_instances: HashMap<String, String>,
}

#[derive(Clone, Debug)]
struct FileOwner {
    window_label: String,
    frontend_instance: String,
    document_id: String,
    opened: bool,
    binding_sequence: u64,
    leases: BTreeSet<String>,
    pending_file: Option<((u64, u64), std::time::SystemTime)>,
}

#[derive(Clone, Debug)]
struct TargetReservation {
    window_label: String,
    frontend_instance: String,
    document_id: String,
    source: Option<String>,
    target: String,
    sequence: u64,
    result: Option<bool>,
}

fn frontend_loaded(registry: &OpenFilesRegistry, window_label: &str) -> Result<String, String> {
    let mut state = registry.0.lock().map_err(|_| "Open-file registry is unavailable")?;
    let instance = uuid::Uuid::new_v4().to_string();
    // A completed native page load has replaced the previous frontend. Retire
    // only that window's documents, under the same lock used for claiming them.
    for owner in state.files.values_mut().filter(|owner| owner.window_label == window_label) {
        owner.opened = false;
    }
    state.files.retain(|_, owner| owner.opened || !owner.leases.is_empty());
    state.reservations.retain(|_, reservation| reservation.window_label != window_label || reservation.result.is_none());
    state.frontend_instances.insert(window_label.to_string(), instance.clone());
    Ok(instance)
}

fn validate_frontend_instance(state: &OpenFileRegistryState, window_label: &str, instance: &str) -> Result<(), String> {
    if state.frontend_instances.get(window_label).map(String::as_str) != Some(instance) {
        return Err("The file-opening frontend instance is no longer current".into());
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct OpenFileClaim {
    file_path: String,
    window_label: String,
    acquired: bool,
    document_id: String,
}

fn normalize_open_file(file_path: &str) -> Result<String, String> {
    let path = std::fs::canonicalize(file_path).map_err(|error| error.to_string())?;
    let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Only existing regular files can be opened".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err("Hardlinked files do not have an unambiguous ownership path".into());
        }
    }
    #[cfg(windows)]
    validate_windows_open_file(&path)?;
    #[cfg(not(any(unix, windows)))]
    return Err("File ownership is not supported on this platform".into());
    path.into_os_string().into_string().map_err(|_| "Non-Unicode ownership paths are unsupported".into())
}

#[cfg(windows)]
fn validate_windows_open_file(path: &Path) -> Result<(u64, u64), String> {
    use std::os::windows::{ffi::OsStrExt, io::{AsRawHandle, FromRawHandle}};
    use std::path::{Component, Prefix};
    use std::ffi::c_void;
    #[repr(C)]
    #[derive(Default)]
    struct Information {
        attributes: u32, times: [u32; 6], volume: u32,
        size_high: u32, size_low: u32, links: u32, index_high: u32, index_low: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateFileW(path: *const u16, access: u32, share: u32, security: *const c_void,
            disposition: u32, flags: u32, template: *mut c_void) -> *mut c_void;
        fn GetFileInformationByHandle(handle: *mut c_void, information: *mut Information) -> i32;
        fn GetDriveTypeW(root: *const u16) -> u32;
    }
    let drive = match path.components().next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => drive,
            _ => return Err("Network and device ownership paths are unsupported".into()),
        },
        _ => return Err("Missing local Windows volume".into()),
    };
    let root = [drive as u16, b':' as u16, b'\\' as u16, 0];
    // SAFETY: a terminated DOS root; only fixed local volumes are accepted.
    if unsafe { GetDriveTypeW(root.as_ptr()) } != 3 {
        return Err("Only fixed local Windows volumes are supported".into());
    }
    let name = path.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    // SAFETY: a terminated canonical path. OPEN_REPARSE_POINT avoids following
    // a replacement link; the returned successful handle is owned by File.
    let handle = unsafe { CreateFileW(name.as_ptr(), 0x80, 7, std::ptr::null(), 3, 0x200000, std::ptr::null_mut()) };
    if handle as isize == -1 { return Err(std::io::Error::last_os_error().to_string()); }
    let file = unsafe { std::fs::File::from_raw_handle(handle) };
    let mut information = Information::default();
    // SAFETY: live handle and a writable BY_HANDLE_FILE_INFORMATION buffer.
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut information) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    if information.links != 1 || information.attributes & (0x400 | 0x10) != 0 {
        return Err("Hardlinks, unresolved reparse points and directories are unsupported".into());
    }
    Ok((information.volume as u64, ((information.index_high as u64) << 32) | information.index_low as u64))
}

fn claim_open_file(registry: &OpenFilesRegistry, file_path: &str, window_label: &str, instance: &str) -> Result<OpenFileClaim, String> {
    let mut state = registry.0.lock().map_err(|_| "Open-file registry is unavailable")?;
    validate_frontend_instance(&state, window_label, instance)?;
    let file_path = normalize_open_file(file_path)?;
    if let Some(owner) = state.files.get(&file_path) {
        return Ok(OpenFileClaim { file_path, window_label: owner.window_label.clone(), document_id: owner.document_id.clone(), acquired: false });
    }
    let document_id = uuid::Uuid::new_v4().to_string();
    state.files.insert(file_path.clone(), FileOwner {
        window_label: window_label.into(), frontend_instance: instance.into(), document_id: document_id.clone(),
        opened: true, binding_sequence: 0, leases: BTreeSet::new(), pending_file: None,
    });
    Ok(OpenFileClaim { file_path, window_label: window_label.into(), document_id, acquired: true })
}

fn release_open_file(registry: &OpenFilesRegistry, file_path: &str, window_label: &str, instance: &str, document_id: Option<&str>) -> Result<bool, String> {
    let mut state = registry.0.lock().map_err(|_| "Open-file registry is unavailable")?;
    validate_frontend_instance(&state, window_label, instance)?;
    let key = if state.files.contains_key(file_path) { file_path.to_string() } else { normalize_open_file(file_path)? };
    let Some(owner) = state.files.get_mut(&key) else { return Ok(false); };
    if owner.window_label != window_label || owner.frontend_instance != instance
        || document_id != Some(owner.document_id.as_str()) { return Ok(false); }
    owner.opened = false;
    if owner.leases.is_empty() { state.files.remove(&key); }
    Ok(true)
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum SaveTargetClaim {
    Reserved { file_path: String, reservation_id: String, created: bool },
    Occupied { file_path: String, window_label: String },
}

fn file_identity(path: &Path) -> Result<(u64, u64), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if !metadata.is_file() || metadata.nlink() != 1 { return Err("Ambiguous file identity".into()); }
        Ok((metadata.dev(), metadata.ino()))
    }
    #[cfg(windows)]
    { validate_windows_open_file(path) }
    #[cfg(not(any(unix, windows)))]
    { Err("Unsupported file identity".into()) }
}

#[cfg(any(windows, test))]
fn valid_windows_save_name(name: &str) -> bool {
    if name.is_empty() || name.ends_with(['.', ' ']) || name.encode_utf16().count() > 255
        || name.chars().any(|c| c <= '\u{1f}' || "<>:\"/\\|?*".contains(c)) { return false; }
    let stem = name.split('.').next().unwrap().trim_end().to_ascii_uppercase();
    !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        && !(stem.chars().count() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.chars().last(), Some('1'..='9' | '¹' | '²' | '³')))
}

fn prepare_save_target(path: &str) -> Result<(String, bool), String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => return normalize_open_file(path).map(|path| (path, false)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
        Err(error) => return Err(error.to_string()),
    }
    let requested = Path::new(path);
    let name = requested.file_name().ok_or("Missing file name")?;
    let parent = std::fs::canonicalize(requested.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new(".")))
        .map_err(|e| e.to_string())?;
    if !parent.is_dir() { return Err("The parent is not a directory".into()); }
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        let name = name.to_str().ok_or("Non-Unicode file name")?;
        if !valid_windows_save_name(name) { return Err("Ambiguous Windows file name".into()); }
        let drive = match parent.components().next() {
            Some(Component::Prefix(prefix)) => match prefix.kind() {
                Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => drive,
                _ => return Err("Network and device save targets are unsupported".into()),
            },
            _ => return Err("Missing local Windows volume".into()),
        };
        #[link(name = "kernel32")]
        extern "system" { fn GetDriveTypeW(root: *const u16) -> u32; }
        let root = [drive as u16, b':' as u16, b'\\' as u16, 0];
        // SAFETY: the fixed-size root buffer is a terminated DOS drive path.
        if unsafe { GetDriveTypeW(root.as_ptr()) } != 3 { return Err("Only fixed local Windows volumes are supported".into()); }
    }
    let candidate = parent.join(name);
    let candidate_text = candidate.to_str().ok_or("Non-Unicode save path")?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    // Exclusive creation resolves case aliases through the filesystem itself.
    match options.open(&candidate) {
        Ok(file) => { drop(file); },
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return normalize_open_file(candidate_text).map(|path| (path, false)),
        Err(error) => return Err(error.to_string()),
    }
    let result = normalize_open_file(candidate_text);
    if result.is_err() { let _ = std::fs::remove_file(&candidate); }
    result.map(|path| (path, true))
}

fn reserve_target(registry: &OpenFilesRegistry, requested: &str, window: &str, instance: &str,
    document: &str, source: Option<&str>, sequence: u64) -> Result<SaveTargetClaim, String> {
    if uuid::Uuid::parse_str(document).is_err() || sequence == 0 { return Err("Invalid document or save identity".into()); }
    let mut state = registry.0.lock().map_err(|_| "Open-file registry is unavailable")?;
    validate_frontend_instance(&state, window, instance)?;
    if state.files.values().any(|owner| owner.document_id == document
        && (owner.window_label != window || owner.frontend_instance != instance)) {
        return Err("The document belongs to another frontend".into());
    }
    if let Some(source) = source {
        let owner = state.files.get(source).ok_or("The source document is not registered")?;
        if !owner.opened || owner.window_label != window || owner.frontend_instance != instance || owner.document_id != document {
            return Err("The source document no longer owns its file".into());
        }
    } else if state.files.values().any(|owner| owner.document_id == document && owner.opened) {
        return Err("The document binding changed".into());
    }
    if std::fs::symlink_metadata(requested).is_err() {
        let requested_path = Path::new(requested);
        let parent = std::fs::canonicalize(requested_path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."))).map_err(|e| e.to_string())?;
        let candidate = parent.join(requested_path.file_name().ok_or("Missing file name")?);
        if let Some(owner) = candidate.to_str().and_then(|path| state.files.get(path)) {
            if owner.window_label != window || owner.frontend_instance != instance || owner.document_id != document {
                return Ok(SaveTargetClaim::Occupied { file_path: candidate.to_str().unwrap().into(), window_label: owner.window_label.clone() });
            }
        }
        #[cfg(windows)]
        if state.files.keys().any(|path| Path::new(path).parent() == Some(parent.as_path()) && !Path::new(path).exists()) {
            return Err("A deleted registered file makes the new target identity ambiguous".into());
        }
    }
    let (target, created) = prepare_save_target(requested)?;
    if let Some(owner) = state.files.get(&target) {
        if owner.window_label != window || owner.frontend_instance != instance || owner.document_id != document {
            return Ok(SaveTargetClaim::Occupied { file_path: target, window_label: owner.window_label.clone() });
        }
    }
    let created_identity = if created {
        Some((file_identity(Path::new(&target))?, std::fs::metadata(&target).and_then(|m| m.modified()).map_err(|e| e.to_string())?))
    } else { None };
    let token = uuid::Uuid::new_v4().to_string();
    let owner = state.files.entry(target.clone()).or_insert_with(|| FileOwner {
        window_label: window.into(), frontend_instance: instance.into(), document_id: document.into(),
        opened: false, binding_sequence: 0, leases: BTreeSet::new(), pending_file: None,
    });
    if created { owner.pending_file = created_identity; }
    owner.leases.insert(token.clone());
    if let Some(source) = source { state.files.get_mut(source).unwrap().leases.insert(token.clone()); }
    state.reservations.insert(token.clone(), TargetReservation {
        window_label: window.into(), frontend_instance: instance.into(), document_id: document.into(),
        source: source.map(String::from), target: target.clone(), sequence, result: None,
    });
    Ok(SaveTargetClaim::Reserved { file_path: target, reservation_id: token, created })
}

fn finish_target(registry: &OpenFilesRegistry, token: &str, window: &str, instance: &str, committed: bool, publish_binding: bool) -> Result<bool, String> {
    let mut state = registry.0.lock().map_err(|_| "Open-file registry is unavailable")?;
    let reservation = state.reservations.get(token).ok_or("Unknown save reservation")?.clone();
    if reservation.window_label != window || reservation.frontend_instance != instance { return Err("Not the reservation owner".into()); }
    if let Some(result) = reservation.result { return Ok(result); }
    let current = state.frontend_instances.get(window).map(String::as_str) == Some(instance);
    let binding = state.files.iter().find(|(_, owner)| owner.document_id == reservation.document_id && owner.opened);
    let source_matches = match binding {
        Some((path, _)) => reservation.source.as_ref() == Some(path),
        None => reservation.source.is_none(),
    };
    let latest = state.files.values().filter(|owner| owner.document_id == reservation.document_id)
        .map(|owner| owner.binding_sequence).max().unwrap_or(0);
    let publish = committed && publish_binding && current && source_matches && reservation.sequence > latest;
    if publish {
        for (path, owner) in state.files.iter_mut().filter(|(_, owner)| owner.document_id == reservation.document_id) {
            owner.opened = path == &reservation.target;
            owner.binding_sequence = reservation.sequence;
            if owner.opened { owner.pending_file = None; }
        }
    }
    if !committed {
        let owner = state.files.get(&reservation.target).ok_or("Reserved owner disappeared")?;
        // Other native leases protect replacement while cleanup checks ownership.
        if owner.leases.len() == 1 && owner.leases.contains(token) {
            if let Some((identity, modified)) = owner.pending_file {
                let path = Path::new(&reservation.target);
                // An atomic replacement has a different identity, including empty content.
                if file_identity(path).ok() == Some(identity)
                    && std::fs::metadata(path).is_ok_and(|m| m.len() == 0 && m.modified().ok() == Some(modified)) {
                    std::fs::remove_file(path).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    for owner in state.files.values_mut() { owner.leases.remove(token); }
    state.files.retain(|_, owner| owner.opened || !owner.leases.is_empty());
    state.reservations.get_mut(token).unwrap().result = Some(publish);
    Ok(publish)
}

#[cfg(test)]
mod open_file_registry_tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let directory = std::env::temp_dir().join(format!("mermark-open-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&directory).unwrap();
            std::fs::write(directory.join("document.md"), "Original").unwrap();
            Self(directory)
        }
        fn path(&self) -> String { self.0.join("document.md").to_str().unwrap().to_string() }
    }
    impl Drop for Fixture {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    fn registry() -> OpenFilesRegistry { OpenFilesRegistry(Mutex::new(OpenFileRegistryState::default())) }

    fn instance(registry: &OpenFilesRegistry, label: &str) -> Result<String, String> {
        let current = registry.0.lock().map_err(|_| "Open-file registry is unavailable")?
            .frontend_instances.get(label).cloned();
        match current { Some(instance) => Ok(instance), None => frontend_loaded(registry, label) }
    }

    fn claim(registry: &OpenFilesRegistry, path: &str, label: &str) -> Result<OpenFileClaim, String> {
        claim_open_file(registry, path, label, &instance(registry, label)?)
    }

    fn release(registry: &OpenFilesRegistry, path: &str, label: &str) -> Result<bool, String> {
        {
            let document = registry.0.lock().unwrap().files.get(path).map(|owner| owner.document_id.clone());
            release_open_file(registry, path, label, &instance(registry, label)?, document.as_deref())
        }
    }

    #[test]
    fn simultaneous_open_attempts_have_exactly_one_owner() {
        let fixture = Fixture::new();
        let registry = Arc::new(registry());
        for index in 0..8 { frontend_loaded(&registry, &format!("window-{index}")).unwrap(); }
        let barrier = Arc::new(Barrier::new(8));
        let workers = (0..8).map(|index| {
            let registry = Arc::clone(&registry);
            let barrier = Arc::clone(&barrier);
            let path = fixture.path();
            std::thread::spawn(move || {
                barrier.wait();
                claim(&registry, &path, &format!("window-{index}")).unwrap()
            })
        }).collect::<Vec<_>>();
        let claims = workers.into_iter().map(|worker| worker.join().unwrap()).collect::<Vec<_>>();
        assert_eq!(claims.iter().filter(|claim| claim.acquired).count(), 1);
        let owner = &claims.iter().find(|claim| claim.acquired).unwrap().window_label;
        assert!(claims.iter().all(|claim| &claim.window_label == owner));
        assert_eq!(registry.0.lock().unwrap().files.len(), 1);
    }

    #[test]
    fn existing_owner_cannot_be_overwritten_even_by_same_window_retry() {
        let fixture = Fixture::new();
        let registry = registry();
        let original = claim(&registry, &fixture.path(), "main").unwrap();
        for window in ["main", "other"] {
            let existing = claim(&registry, &fixture.path(), window).unwrap();
            assert!(!existing.acquired);
            assert_eq!(existing.window_label, "main");
            assert_eq!(existing.file_path, original.file_path);
        }
    }

    #[test]
    fn lexical_aliases_share_the_existing_owner() {
        let fixture = Fixture::new();
        let registry = registry();
        let original = claim(&registry, &fixture.path(), "main").unwrap();
        std::fs::create_dir(fixture.0.join("child")).unwrap();
        let alias = fixture.0.join("child/.././document.md");
        let claim = claim(&registry, alias.to_str().unwrap(), "other").unwrap();
        assert!(!claim.acquired);
        assert_eq!(claim.file_path, original.file_path);
        assert_eq!(claim.window_label, "main");
    }

    #[cfg(unix)]
    #[test]
    fn relative_paths_share_the_existing_owner_without_changing_the_process_directory() {
        let fixture = Fixture::new();
        let registry = registry();
        let original = claim(&registry, &fixture.path(), "main").unwrap();
        let mut relative = PathBuf::new();
        for component in std::env::current_dir().unwrap().components() {
            if matches!(component, std::path::Component::Normal(_)) { relative.push(".."); }
        }
        relative.push(Path::new(&fixture.path()).strip_prefix("/").unwrap());
        let existing = claim(&registry, relative.to_str().unwrap(), "other").unwrap();
        assert!(!existing.acquired);
        assert_eq!(existing.file_path, original.file_path);
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_aliases_share_the_existing_owner() {
        let fixture = Fixture::new();
        let registry = registry();
        let original = claim(&registry, &fixture.path(), "main").unwrap();
        let alias = fixture.0.join("alias.md");
        std::os::unix::fs::symlink(fixture.path(), &alias).unwrap();
        let existing = claim(&registry, alias.to_str().unwrap(), "other").unwrap();
        assert!(!existing.acquired);
        assert_eq!(existing.file_path, original.file_path);
    }

    #[cfg(windows)]
    #[test]
    fn windows_case_aliases_share_the_existing_owner() {
        let fixture = Fixture::new();
        let registry = registry();
        let original = claim(&registry, &fixture.path(), "main").unwrap();
        let existing = claim(&registry, fixture.0.join("DOCUMENT.MD").to_str().unwrap(), "other").unwrap();
        assert!(!existing.acquired);
        assert_eq!(existing.file_path, original.file_path);
    }

    #[test]
    fn missing_and_ambiguous_files_are_not_registered() {
        let fixture = Fixture::new();
        let registry = registry();
        assert!(claim(&registry, fixture.0.join("missing.md").to_str().unwrap(), "main").is_err());
        assert!(claim(&registry, fixture.0.to_str().unwrap(), "main").is_err());
        let link = fixture.0.join("hardlink.md");
        std::fs::hard_link(fixture.path(), &link).unwrap();
        assert!(claim(&registry, &fixture.path(), "main").is_err());
        assert!(registry.0.lock().unwrap().files.is_empty());
    }

    #[test]
    fn registry_failure_is_reported_instead_of_granting_ownership() {
        let fixture = Fixture::new();
        let registry = Arc::new(registry());
        let poisoned = Arc::clone(&registry);
        let _ = std::thread::spawn(move || {
            let _guard = poisoned.0.lock().unwrap();
            panic!("Poison the registry for the error regression");
        }).join();
        assert!(claim(&registry, &fixture.path(), "main").unwrap_err().contains("unavailable"));
        assert!(registry.0.lock().unwrap_err().into_inner().files.is_empty());
    }

    #[test]
    fn failed_load_release_only_removes_the_current_window_owner() {
        let fixture = Fixture::new();
        let registry = registry();
        let claimed = claim(&registry, &fixture.path(), "main").unwrap();
        assert!(!release(&registry, &claimed.file_path, "other").unwrap());
        assert!(release(&registry, &claimed.file_path, "main").unwrap());
        assert!(claim(&registry, &fixture.path(), "other").unwrap().acquired);
        assert!(!release(&registry, &claimed.file_path, "main").unwrap());
        assert_eq!(registry.0.lock().unwrap().files.get(&claimed.file_path).unwrap().window_label, "other");
    }

    #[test]
    fn an_owner_can_release_its_registered_path_after_file_deletion() {
        let fixture = Fixture::new();
        let registry = registry();
        let claim = claim(&registry, &fixture.path(), "main").unwrap();
        std::fs::remove_file(fixture.path()).unwrap();
        assert!(!release(&registry, &claim.file_path, "other").unwrap());
        assert!(release(&registry, &claim.file_path, "main").unwrap());
        assert!(registry.0.lock().unwrap().files.is_empty());
    }

    #[test]
    fn completed_reload_retires_only_the_replaced_frontend() {
        let fixture = Fixture::new();
        let registry = registry();
        let other_path = fixture.0.join("other.md");
        std::fs::write(&other_path, "Other document").unwrap();
        let old = frontend_loaded(&registry, "main").unwrap();
        claim_open_file(&registry, &fixture.path(), "main", &old).unwrap();
        let other = frontend_loaded(&registry, "other").unwrap();
        claim_open_file(&registry, other_path.to_str().unwrap(), "other", &other).unwrap();

        let current = frontend_loaded(&registry, "main").unwrap();
        assert_ne!(old, current);
        assert!(claim_open_file(&registry, &fixture.path(), "main", &current).unwrap().acquired);
        let existing = claim_open_file(&registry, other_path.to_str().unwrap(), "main", &current).unwrap();
        assert!(!existing.acquired);
        assert_eq!(existing.window_label, "other");
        assert_eq!(registry.0.lock().unwrap().files.len(), 2);
        assert_eq!(std::fs::read_to_string(fixture.path()).unwrap(), "Original");
        assert_eq!(std::fs::read_to_string(other_path).unwrap(), "Other document");
    }

    #[test]
    fn matching_window_name_does_not_authorize_a_different_frontend() {
        let fixture = Fixture::new();
        let registry = registry();
        let current = frontend_loaded(&registry, "main").unwrap();
        claim_open_file(&registry, &fixture.path(), "main", &current).unwrap();
        assert!(claim_open_file(&registry, &fixture.path(), "main", "unrecognized").is_err());
        assert!(release_open_file(&registry, &fixture.path(), "main", "unrecognized", None).is_err());
        assert!(!claim_open_file(&registry, &fixture.path(), "main", &current).unwrap().acquired);
        assert_eq!(registry.0.lock().unwrap().files.len(), 1);
    }

    #[test]
    fn delayed_commands_from_the_retired_frontend_cannot_change_new_ownership() {
        let fixture = Fixture::new();
        let registry = registry();
        let old = frontend_loaded(&registry, "main").unwrap();
        claim_open_file(&registry, &fixture.path(), "main", &old).unwrap();
        let current = frontend_loaded(&registry, "main").unwrap();
        let claimed = claim_open_file(&registry, &fixture.path(), "main", &current).unwrap();
        assert!(release_open_file(&registry, &claimed.file_path, "main", &old, None).is_err());
        assert!(claim_open_file(&registry, &fixture.path(), "main", &old).is_err());
        assert_eq!(registry.0.lock().unwrap().files.get(&claimed.file_path).unwrap().window_label, "main");
        assert!(release_open_file(&registry, &claimed.file_path, "main", &current, Some(&claimed.document_id)).unwrap());
        assert_eq!(std::fs::read_to_string(fixture.path()).unwrap(), "Original");
    }

    #[test]
    fn reload_and_another_window_compete_for_only_one_owner() {
        let fixture = Fixture::new();
        let registry = Arc::new(registry());
        let old = frontend_loaded(&registry, "main").unwrap();
        claim_open_file(&registry, &fixture.path(), "main", &old).unwrap();
        let clients = [
            ("main", frontend_loaded(&registry, "main").unwrap()),
            ("other", frontend_loaded(&registry, "other").unwrap()),
        ];
        let barrier = Arc::new(Barrier::new(2));
        let workers = clients.into_iter().map(|(label, instance)| {
            let registry = Arc::clone(&registry);
            let barrier = Arc::clone(&barrier);
            let path = fixture.path();
            std::thread::spawn(move || {
                barrier.wait();
                claim_open_file(&registry, &path, label, &instance).unwrap()
            })
        }).collect::<Vec<_>>();
        let claims = workers.into_iter().map(|worker| worker.join().unwrap()).collect::<Vec<_>>();
        assert_eq!(claims.iter().filter(|claim| claim.acquired).count(), 1);
        assert_eq!(claims[0].window_label, claims[1].window_label);
        assert_eq!(registry.0.lock().unwrap().files.len(), 1);
        assert_eq!(std::fs::read_to_string(fixture.path()).unwrap(), "Original");
    }
    fn reserved(result: SaveTargetClaim) -> (String, String) {
        match result {
            SaveTargetClaim::Reserved { file_path, reservation_id, .. } => (file_path, reservation_id),
            other => panic!("Expected reservation: {other:?}"),
        }
    }

    #[test]
    fn save_as_rejects_other_documents_in_the_same_and_other_windows() {
        for label in ["main", "other"] {
            let fixture = Fixture::new();
            let registry = registry();
            let source = fixture.0.join("source.md");
            std::fs::write(&source, "Source").unwrap();
            let a = claim(&registry, source.to_str().unwrap(), "main").unwrap();
            let b = claim(&registry, &fixture.path(), label).unwrap();
            let result = reserve_target(&registry, &fixture.path(), "main", &instance(&registry, "main").unwrap(),
                &a.document_id, Some(&a.file_path), 1).unwrap();
            assert!(matches!(result, SaveTargetClaim::Occupied { .. }));
            assert_eq!(std::fs::read_to_string(fixture.path()).unwrap(), "Original");
            assert_eq!(std::fs::read_to_string(source).unwrap(), "Source");
            let state = registry.0.lock().unwrap();
            assert_eq!(state.files[&b.file_path].document_id, b.document_id);
            assert!(state.reservations.is_empty());
        }
    }

    #[test]
    fn opening_and_save_as_compete_atomically_for_one_target() {
        let fixture = Fixture::new();
        let registry = Arc::new(registry());
        let a = instance(&registry, "saving").unwrap();
        let b = instance(&registry, "opening").unwrap();
        let document = uuid::Uuid::new_v4().to_string();
        let barrier = Arc::new(Barrier::new(2));
        let save = {
            let registry = registry.clone(); let barrier = barrier.clone(); let path = fixture.path();
            std::thread::spawn(move || { barrier.wait(); reserve_target(&registry, &path, "saving", &a, &document, None, 1).unwrap() })
        };
        let open = {
            let registry = registry.clone(); let barrier = barrier.clone(); let path = fixture.path();
            std::thread::spawn(move || { barrier.wait(); claim_open_file(&registry, &path, "opening", &b).unwrap() })
        };
        let saving = matches!(save.join().unwrap(), SaveTargetClaim::Reserved { .. });
        let opening = open.join().unwrap().acquired;
        assert_ne!(saving, opening);
        assert_eq!(registry.0.lock().unwrap().files.len(), 1);
        assert_eq!(std::fs::read_to_string(fixture.path()).unwrap(), "Original");
    }

    #[test]
    fn successful_save_as_publishes_new_owner_and_safely_retires_the_source() {
        let fixture = Fixture::new(); let registry = registry();
        let a = claim(&registry, &fixture.path(), "main").unwrap();
        let instance = instance(&registry, "main").unwrap();
        let destination = fixture.0.join("new.md");
        let (path, token) = reserved(reserve_target(&registry, destination.to_str().unwrap(), "main", &instance,
            &a.document_id, Some(&a.file_path), 1).unwrap());
        assert!(!claim(&registry, &path, "other").unwrap().acquired);
        let temp = fixture.0.join("payload.tmp"); std::fs::write(&temp, "Saved").unwrap(); std::fs::rename(&temp, &path).unwrap();
        assert!(finish_target(&registry, &token, "main", &instance, true, true).unwrap());
        assert!(finish_target(&registry, &token, "main", &instance, true, true).unwrap());
        assert!(claim(&registry, &a.file_path, "other").unwrap().acquired);
        let state = registry.0.lock().unwrap();
        assert_eq!(state.files[&path].document_id, a.document_id);
        assert_eq!(state.files[&path].window_label, "main");
        assert!(state.files[&path].opened);
        assert_eq!(std::fs::read_to_string(path).unwrap(), "Saved");
    }

    #[test]
    fn cancellation_preserves_existing_content_and_only_releases_the_matching_lease() {
        let fixture = Fixture::new(); let registry = registry(); let instance = instance(&registry, "main").unwrap();
        let document = uuid::Uuid::new_v4().to_string();
        let (path, token) = reserved(reserve_target(&registry, &fixture.path(), "main", &instance, &document, None, 1).unwrap());
        assert!(finish_target(&registry, &token, "other", &instance, false, false).is_err());
        assert!(!claim(&registry, &path, "other").unwrap().acquired);
        assert!(!finish_target(&registry, &token, "main", &instance, false, false).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "Original");
        assert!(claim(&registry, &path, "other").unwrap().acquired);
        assert!(!finish_target(&registry, &token, "main", &instance, false, false).unwrap());
        assert_eq!(registry.0.lock().unwrap().files[&path].window_label, "other");
    }

    #[test]
    fn cancelled_new_file_is_removed_but_other_reservations_protect_their_replacement() {
        let fixture = Fixture::new(); let registry = registry(); let instance = instance(&registry, "main").unwrap();
        let document = uuid::Uuid::new_v4().to_string(); let destination = fixture.0.join("new.md");
        let (path, a) = reserved(reserve_target(&registry, destination.to_str().unwrap(), "main", &instance, &document, None, 1).unwrap());
        let (_, b) = reserved(reserve_target(&registry, &path, "main", &instance, &document, None, 2).unwrap());
        assert!(!finish_target(&registry, &a, "main", &instance, false, false).unwrap());
        assert!(Path::new(&path).exists());
        let temp = fixture.0.join("other.tmp"); std::fs::write(&temp, "B").unwrap(); std::fs::rename(&temp, &path).unwrap();
        assert!(finish_target(&registry, &b, "main", &instance, true, true).unwrap());
        assert!(!finish_target(&registry, &a, "main", &instance, false, false).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "B");
    }

    #[test]
    fn the_last_cancelled_reservation_cleans_up_its_new_file() {
        let fixture = Fixture::new(); let registry = registry(); let instance = instance(&registry, "main").unwrap();
        let document = uuid::Uuid::new_v4().to_string(); let destination = fixture.0.join("new.md");
        let (path, a) = reserved(reserve_target(&registry, destination.to_str().unwrap(), "main", &instance, &document, None, 1).unwrap());
        let (_, b) = reserved(reserve_target(&registry, &path, "main", &instance, &document, None, 2).unwrap());
        finish_target(&registry, &a, "main", &instance, false, false).unwrap();
        finish_target(&registry, &b, "main", &instance, false, false).unwrap();
        assert!(!Path::new(&path).exists());
        assert!(registry.0.lock().unwrap().files.is_empty());
    }

    #[test]
    fn an_atomic_empty_save_is_not_deleted_by_cancelled_cleanup() {
        let fixture = Fixture::new(); let registry = registry(); let instance = instance(&registry, "main").unwrap();
        let document = uuid::Uuid::new_v4().to_string(); let destination = fixture.0.join("new.md");
        let (path, token) = reserved(reserve_target(&registry, destination.to_str().unwrap(), "main", &instance, &document, None, 1).unwrap());
        let temp = fixture.0.join("empty.tmp"); std::fs::write(&temp, "").unwrap(); std::fs::rename(&temp, &path).unwrap();
        finish_target(&registry, &token, "main", &instance, false, false).unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "");
    }

    #[test]
    fn delayed_completion_and_delayed_release_cannot_replace_a_new_binding() {
        let fixture = Fixture::new(); let registry = registry(); let instance = instance(&registry, "main").unwrap();
        let source = claim(&registry, &fixture.path(), "main").unwrap();
        let a_path = fixture.0.join("a.md"); let b_path = fixture.0.join("b.md");
        let (a_path, a) = reserved(reserve_target(&registry, a_path.to_str().unwrap(), "main", &instance, &source.document_id, Some(&source.file_path), 1).unwrap());
        let (b_path, b) = reserved(reserve_target(&registry, b_path.to_str().unwrap(), "main", &instance, &source.document_id, Some(&source.file_path), 2).unwrap());
        assert!(finish_target(&registry, &b, "main", &instance, true, true).unwrap());
        assert!(!finish_target(&registry, &a, "main", &instance, true, true).unwrap());
        assert!(!release_open_file(&registry, &b_path, "main", &instance, Some("old-document")).unwrap());
        let state = registry.0.lock().unwrap();
        assert!(state.files[&b_path].opened);
        assert!(!state.files.contains_key(&a_path));
        assert!(!state.files.contains_key(&source.file_path));
    }

    #[test]
    fn a_newer_failed_save_does_not_invalidate_the_older_reservation() {
        let fixture = Fixture::new(); let registry = registry(); let instance = instance(&registry, "main").unwrap();
        let source = claim(&registry, &fixture.path(), "main").unwrap();
        let (_, a) = reserved(reserve_target(&registry, &source.file_path, "main", &instance, &source.document_id, Some(&source.file_path), 1).unwrap());
        let (_, b) = reserved(reserve_target(&registry, &source.file_path, "main", &instance, &source.document_id, Some(&source.file_path), 2).unwrap());
        finish_target(&registry, &b, "main", &instance, false, false).unwrap();
        assert!(finish_target(&registry, &a, "main", &instance, true, true).unwrap());
    }

    #[test]
    fn reload_cannot_release_a_target_while_its_old_write_is_unresolved() {
        let fixture = Fixture::new(); let registry = registry(); let old = instance(&registry, "main").unwrap();
        let source = claim(&registry, &fixture.path(), "main").unwrap();
        let (_, token) = reserved(reserve_target(&registry, &source.file_path, "main", &old, &source.document_id, Some(&source.file_path), 1).unwrap());
        frontend_loaded(&registry, "main").unwrap();
        assert!(!claim(&registry, &source.file_path, "other").unwrap().acquired);
        assert!(!finish_target(&registry, &token, "main", &old, true, true).unwrap());
        assert!(claim(&registry, &source.file_path, "other").unwrap().acquired);
    }

    #[test]
    fn deleted_owned_target_is_rejected_without_recreating_it() {
        let fixture = Fixture::new(); let registry = registry(); let instance = instance(&registry, "main").unwrap();
        claim(&registry, &fixture.path(), "other").unwrap(); std::fs::remove_file(fixture.path()).unwrap();
        let document = uuid::Uuid::new_v4().to_string();
        assert!(matches!(reserve_target(&registry, &fixture.path(), "main", &instance, &document, None, 1).unwrap(), SaveTargetClaim::Occupied { .. }));
        assert!(!Path::new(&fixture.path()).exists());
    }

    #[cfg(unix)]
    #[test]
    fn new_reservations_are_private_and_symlink_aliases_share_the_existing_owner() {
        use std::os::unix::{fs::PermissionsExt, fs::symlink};
        let fixture = Fixture::new(); let registry = registry(); let instance = instance(&registry, "main").unwrap();
        let document = uuid::Uuid::new_v4().to_string(); let target = fixture.0.join("new.md");
        let (path, token) = reserved(reserve_target(&registry, target.to_str().unwrap(), "main", &instance, &document, None, 1).unwrap());
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        let alias = fixture.0.join("alias.md"); symlink(&path, &alias).unwrap();
        assert!(!claim(&registry, alias.to_str().unwrap(), "other").unwrap().acquired);
        finish_target(&registry, &token, "main", &instance, false, false).unwrap();
    }

    #[test]
    fn invalid_targets_and_wrong_document_ids_do_not_mutate_files_or_registration() {
        let fixture = Fixture::new(); let registry = registry(); let instance = instance(&registry, "main").unwrap();
        let source = claim(&registry, &fixture.path(), "main").unwrap();
        let target = fixture.0.join("new.md");
        let wrong = uuid::Uuid::new_v4().to_string();
        assert!(reserve_target(&registry, target.to_str().unwrap(), "main", &instance, &wrong, Some(&source.file_path), 1).is_err());
        assert!(!target.exists());
        assert!(reserve_target(&registry, fixture.0.to_str().unwrap(), "main", &instance, &source.document_id, Some(&source.file_path), 1).is_err());
        assert!(reserve_target(&registry, fixture.0.join("missing/new.md").to_str().unwrap(), "main", &instance, &source.document_id, Some(&source.file_path), 1).is_err());
        assert_eq!(std::fs::read_to_string(&source.file_path).unwrap(), "Original");
        assert_eq!(registry.0.lock().unwrap().files.len(), 1);
        assert!(registry.0.lock().unwrap().reservations.is_empty());
    }

    #[test]
    fn native_finalization_does_not_publish_a_binding_rejected_by_the_frontend() {
        let fixture = Fixture::new(); let registry = registry(); let instance = instance(&registry, "main").unwrap();
        let source = claim(&registry, &fixture.path(), "main").unwrap();
        let target = fixture.0.join("new.md");
        let (path, token) = reserved(reserve_target(&registry, target.to_str().unwrap(), "main", &instance, &source.document_id, Some(&source.file_path), 1).unwrap());
        assert!(!finish_target(&registry, &token, "main", &instance, true, false).unwrap());
        let state = registry.0.lock().unwrap();
        assert!(state.files[&source.file_path].opened);
        assert!(!state.files.contains_key(&path));
    }

    #[test]
    fn windows_ambiguous_file_names_are_rejected_before_creation() {
        for name in ["CON.md", "aux", "lPt1.txt", "COM¹.md", "name.", "name ", "file:stream", "NUL .md", "a?b.md"] {
            assert!(!valid_windows_save_name(name), "{name}");
        }
        for name in ["document.md", "Notes 2026.md", "Årsrapport.md", "comparison.md"] {
            assert!(valid_windows_save_name(name), "{name}");
        }
    }

    #[test]
    fn another_frontend_cannot_reuse_a_document_identity_from_a_pending_reservation() {
        let fixture = Fixture::new(); let registry = registry();
        let a = instance(&registry, "main").unwrap(); let b = instance(&registry, "other").unwrap();
        let document = uuid::Uuid::new_v4().to_string();
        let first = fixture.0.join("a.md"); let second = fixture.0.join("b.md");
        reserved(reserve_target(&registry, first.to_str().unwrap(), "main", &a, &document, None, 1).unwrap());
        assert!(reserve_target(&registry, second.to_str().unwrap(), "other", &b, &document, None, 1).is_err());
        assert!(!second.exists());
        assert_eq!(registry.0.lock().unwrap().files.len(), 1);
    }

}

// Counter for unique window IDs
static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

fn is_supported_markdown_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false)
}

// Payload for transferring tabs between windows
#[derive(Clone, Serialize, Deserialize)]
pub struct TabTransferPayload {
    pub file_path: String,
    pub source_window: String,
    pub target_window: String,
}

#[tauri::command]
fn get_open_file_path(state: tauri::State<'_, OpenFileState>) -> Option<String> {
    let mut path = state.0.lock().unwrap();
    path.take()
}

// Register a file as open in a specific window
#[tauri::command]
fn register_open_file(
    registry: tauri::State<'_, OpenFilesRegistry>,
    window: tauri::Window,
    file_path: String,
    window_label: String,
    frontend_instance: String,
) -> Result<OpenFileClaim, String> {
    if window.label() != window_label { return Err("Cannot register ownership for another window".into()); }
    claim_open_file(&registry, &file_path, window.label(), &frontend_instance)
}

// Unregister a file when it's closed
#[tauri::command]
fn unregister_open_file(
    registry: tauri::State<'_, OpenFilesRegistry>,
    window: tauri::Window,
    file_path: String,
    frontend_instance: String,
    document_id: Option<String>,
) -> Result<bool, String> {
    release_open_file(&registry, &file_path, window.label(), &frontend_instance, document_id.as_deref())
}

// Unregister all files for a specific window (when window closes)
#[tauri::command]
fn unregister_window_files(
    registry: tauri::State<'_, OpenFilesRegistry>,
    window: tauri::Window,
    window_label: String,
    frontend_instance: String,
) -> Result<(), String> {
    if window.label() != window_label { return Err("Cannot release another window's files".into()); }
    let mut state = registry.0.lock().map_err(|_| "Open-file registry is unavailable")?;
    validate_frontend_instance(&state, window.label(), &frontend_instance)?;
    for owner in state.files.values_mut().filter(|owner| owner.window_label == window_label) { owner.opened = false; }
    state.files.retain(|_, owner| owner.opened || !owner.leases.is_empty());
    Ok(())
}

// Check if a file is already open and return the window label if so
#[tauri::command]
fn check_file_open(
    registry: tauri::State<'_, OpenFilesRegistry>,
    file_path: String,
) -> Result<Option<String>, String> {
    let canonical = normalize_open_file(&file_path)?;
    let files = registry.0.lock().map_err(|_| "Open-file registry is unavailable")?;
    Ok(files.files.get(&canonical).map(|owner| owner.window_label.clone()))
}

// Focus the window that has a specific file open
#[tauri::command]
async fn focus_window_with_file(
    app: tauri::AppHandle,
    registry: tauri::State<'_, OpenFilesRegistry>,
    file_path: String,
) -> Result<bool, String> {
    let file_path = normalize_open_file(&file_path)?;
    let window_label = {
        let files = registry.0.lock().map_err(|_| "Open-file registry is unavailable")?;
        files.files.get(&file_path).map(|owner| owner.window_label.clone())
    };

    if let Some(label) = window_label {
        if let Some(window) = app.get_webview_window(&label) {
            // Bring window to front even if minimized (#49)
            if window.is_minimized().unwrap_or(false) {
                let _ = window.unminimize();
            }
            if !window.is_visible().unwrap_or(true) {
                let _ = window.show();
            }
            window.set_focus().map_err(|e| e.to_string())?;
            // Emit event to switch to the tab with this file
            window.emit("focus-file", file_path).map_err(|e| e.to_string())?;
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
fn reserve_save_target(app: tauri::AppHandle, registry: tauri::State<'_, OpenFilesRegistry>, window: tauri::Window,
    file_path: String, frontend_instance: String, document_id: String, source_path: Option<String>, sequence: u64) -> Result<SaveTargetClaim, String> {
    let requested = Path::new(&file_path);
    let resolved = if std::fs::symlink_metadata(requested).is_ok() {
        std::fs::canonicalize(requested).map_err(|e| e.to_string())?
    } else {
        let parent = requested.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
        std::fs::canonicalize(parent).map_err(|e| e.to_string())?.join(requested.file_name().ok_or("Missing file name")?)
    };
    if !app.fs_scope().is_allowed(&file_path) || !app.fs_scope().is_allowed(&resolved) {
        return Err("Save target is outside the permitted filesystem scope".into());
    }
    reserve_target(&registry, resolved.to_str().ok_or("Non-Unicode save path")?, window.label(), &frontend_instance, &document_id, source_path.as_deref(), sequence)
}

#[tauri::command]
fn finish_save_target(registry: tauri::State<'_, OpenFilesRegistry>, window: tauri::Window,
    reservation_id: String, frontend_instance: String, committed: bool, publish: bool) -> Result<bool, String> {
    finish_target(&registry, &reservation_id, window.label(), &frontend_instance, committed, publish)
}

// Dedicated window that renders the print-ready document for native printing.
const PRINT_WINDOW_LABEL: &str = "window-print";
// Custom URI scheme that serves the print-ready HTML from memory.
const PRINT_SCHEME: &str = "mermarkprint";

// Holds the print-ready HTML served to the print window by the custom protocol.
pub struct PrintHtmlState(pub Mutex<Option<String>>);

#[tauri::command]
fn get_all_windows(app: tauri::AppHandle) -> Vec<String> {
    app.webview_windows()
        .keys()
        .filter(|label| *label != PRINT_WINDOW_LABEL)
        .cloned()
        .collect()
}

/// Render the print-ready HTML in a dedicated webview window and fire the native
/// print dialog on it. WKWebView (macOS) ignores `print()` on iframes, so the
/// in-app preview iframe could never print there (#103).
///
/// The window loads its content from the in-memory `mermarkprint://` protocol
/// rather than `file://` (which WKWebView refuses via `loadRequest:`) or post-
/// load JS injection (which rendered blank). `async` keeps window creation off
/// the main thread, since creating a webview from a sync command can deadlock.
#[tauri::command]
async fn print_document(app: tauri::AppHandle, html: String) -> Result<(), String> {
    *app.state::<PrintHtmlState>().0.lock().unwrap() = Some(html);

    if let Some(existing) = app.get_webview_window(PRINT_WINDOW_LABEL) {
        let _ = existing.close();
    }

    // Custom schemes resolve to `scheme://localhost` on macOS/Linux but
    // `http://scheme.localhost` on Windows/Android.
    let url = if cfg!(any(windows, target_os = "android")) {
        format!("http://{PRINT_SCHEME}.localhost/")
    } else {
        format!("{PRINT_SCHEME}://localhost/")
    };
    let url = tauri::Url::parse(&url).map_err(|e| e.to_string())?;

    WebviewWindowBuilder::new(&app, PRINT_WINDOW_LABEL, WebviewUrl::CustomProtocol(url))
        .title("MerMark — Print / PDF")
        .inner_size(900.0, 1100.0)
        .center()
        .initialization_script("window.addEventListener('afterprint',function(){window.close();});")
        // on_page_load runs on the UI thread — which WKWebView's print() requires —
        // and firing on Finished prints exactly when the document is ready.
        .on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = window.print();
            }
        })
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_current_window_label(window: tauri::Window) -> String {
    window.label().to_string()
}

#[tauri::command]
async fn transfer_tab_to_window(
    app: tauri::AppHandle,
    registry: tauri::State<'_, OpenFilesRegistry>,
    window: tauri::Window,
    file_path: String,
    source_window: String,
    target_window: String,
    frontend_instance: String,
) -> Result<(), String> {
    if window.label() != source_window { return Err("Cannot transfer another window's document".into()); }
    let payload = TabTransferPayload {
        file_path: file_path.clone(),
        source_window: source_window.clone(),
        target_window: target_window.clone(),
    };

    if let Some(target) = app.get_webview_window(&target_window) {
        {
            let mut files = registry.0.lock().map_err(|_| "Open-file registry is unavailable")?;
            validate_frontend_instance(&files, window.label(), &frontend_instance)?;
            let target_instance = files.frontend_instances.get(&target_window).ok_or("Target frontend is unavailable")?.clone();
            commit_tab_transfer(&mut files.files, &file_path, &source_window, &target_window, &target_instance, || {
                target.emit("tab-transfer", payload).map_err(|e| e.to_string())
            })?;
        }
        // Focus failure cannot undo an already delivered ownership handoff.
        let _ = target.set_focus();
    } else {
        return Err(format!("Window {} not found", target_window));
    }

    Ok(())
}

fn commit_tab_transfer(
    files: &mut HashMap<String, FileOwner>,
    file_path: &str,
    source_window: &str,
    target_window: &str,
    target_instance: &str,
    deliver: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let previous = files.get(file_path).cloned();
    if previous.as_ref().is_some_and(|owner| owner.window_label != source_window || !owner.leases.is_empty()) {
        return Err("Source window no longer owns the file".to_string());
    }
    let mut target_owner = previous.clone().ok_or("The transferred file is not registered")?;
    target_owner.window_label = target_window.into();
    target_owner.frontend_instance = target_instance.into();
    target_owner.binding_sequence = 0;
    files.insert(file_path.to_string(), target_owner);
    if let Err(error) = deliver() {
        match previous {
            Some(owner) => { files.insert(file_path.to_string(), owner); }
            None => { files.remove(file_path); }
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tab_transfer_tests {
    use super::{commit_tab_transfer, FileOwner};
    use std::collections::BTreeSet;
    fn owner(label: &str) -> FileOwner { FileOwner { window_label: label.into(), frontend_instance: "instance".into(), document_id: "doc".into(), opened: true, binding_sequence: 0, leases: BTreeSet::new(), pending_file: None } }
    use std::collections::HashMap;

    #[test]
    fn successful_transfer_moves_ownership() {
        let mut files = HashMap::from([("doc.md".to_string(), owner("main"))]);
        commit_tab_transfer(&mut files, "doc.md", "main", "target", "instance", || Ok(())).unwrap();
        assert_eq!(files.get("doc.md").map(|owner| owner.window_label.as_str()), Some("target"));
    }

    #[test]
    fn failed_delivery_restores_ownership() {
        let mut files = HashMap::from([("doc.md".to_string(), owner("main"))]);
        assert!(commit_tab_transfer(&mut files, "doc.md", "main", "target", "instance", || Err("missing".to_string())).is_err());
        assert_eq!(files.get("doc.md").map(|owner| owner.window_label.as_str()), Some("main"));
    }

    #[test]
    fn rejects_another_owner_before_delivery() {
        let mut files = HashMap::from([("doc.md".to_string(), owner("other"))]);
        assert!(commit_tab_transfer(&mut files, "doc.md", "main", "target", "instance", || panic!("must not deliver")).is_err());
        assert_eq!(files.get("doc.md").map(|owner| owner.window_label.as_str()), Some("other"));
    }
}

// ============== AI commands (storage + health) ==============

use ai::types::{AccessMap, AuditEntry, CliKind, HealthStatus, SessionMapping, SnapshotIndexEntry};

#[tauri::command]
async fn ai_health_check(cli: CliKind, override_path: Option<String>) -> HealthStatus {
    ai::health::check(cli, override_path.as_deref()).await
}

#[tauri::command]
async fn ai_ollama_models(base_url: Option<String>) -> Result<Vec<String>, String> {
    ai::process::ollama::list_models(base_url.as_deref()).await
}

#[tauri::command]
async fn ai_openai_models(base_url: Option<String>) -> Result<Vec<String>, String> {
    ai::process::openai::list_models(base_url.as_deref()).await
}

#[tauri::command]
async fn ai_codex_models() -> Vec<ai::process::codex::CodexModelOption> {
    ai::process::codex::list_models().await
}

#[tauri::command]
fn ai_access_load(app: tauri::AppHandle, doc_path: String) -> Result<AccessMap, String> {
    ai::access_map::load(&app, &doc_path)
}

#[tauri::command]
fn ai_access_save(app: tauri::AppHandle, doc_path: String, map: AccessMap) -> Result<(), String> {
    ai::access_map::save(&app, &doc_path, &map)
}

#[tauri::command]
fn ai_access_migrate(app: tauri::AppHandle, old_path: String, new_path: String) -> Result<(), String> {
    ai::access_map::migrate(&app, &old_path, &new_path)
}

#[tauri::command]
fn ai_session_get(app: tauri::AppHandle, doc_path: String) -> Result<Option<SessionMapping>, String> {
    ai::sessions::get(&app, &doc_path)
}

#[tauri::command]
fn ai_session_upsert(app: tauri::AppHandle, mapping: SessionMapping) -> Result<(), String> {
    ai::sessions::upsert(&app, mapping)
}

#[tauri::command]
fn ai_session_remove(app: tauri::AppHandle, doc_path: String) -> Result<(), String> {
    ai::sessions::remove(&app, &doc_path)
}

#[tauri::command]
fn ai_session_migrate(app: tauri::AppHandle, old_path: String, new_path: String) -> Result<(), String> {
    ai::sessions::migrate(&app, &old_path, &new_path)
}

#[tauri::command]
fn ai_session_recover_by_hash(app: tauri::AppHandle, content_hash: String, cli: CliKind) -> Result<Option<SessionMapping>, String> {
    ai::sessions::recover_by_hash(&app, &content_hash, cli)
}

#[tauri::command]
fn ai_snapshot_list(app: tauri::AppHandle, doc_path: String) -> Result<Vec<SnapshotIndexEntry>, String> {
    ai::snapshots::list(&app, &doc_path)
}

#[tauri::command]
fn ai_snapshot_create(app: tauri::AppHandle, doc_path: String, content: String, source_session_id: Option<String>, keep: usize) -> Result<SnapshotIndexEntry, String> {
    ai::snapshots::create(&app, &doc_path, &content, source_session_id, keep)
}

#[tauri::command]
fn ai_snapshot_restore(app: tauri::AppHandle, doc_path: String, id: String) -> Result<String, String> {
    ai::snapshots::restore(&app, &doc_path, &id)
}

#[tauri::command]
fn ai_snapshot_set_pinned(app: tauri::AppHandle, doc_path: String, id: String, pinned: bool) -> Result<(), String> {
    ai::snapshots::set_pinned(&app, &doc_path, &id, pinned)
}

#[tauri::command]
fn ai_snapshot_delete(app: tauri::AppHandle, doc_path: String, id: String) -> Result<(), String> {
    ai::snapshots::delete(&app, &doc_path, &id)
}

#[tauri::command]
fn ai_snapshot_export(app: tauri::AppHandle, doc_path: String, id: String, dest: String) -> Result<(), String> {
    ai::snapshots::export(&app, &doc_path, &id, std::path::Path::new(&dest))
}

#[tauri::command]
fn ai_snapshot_migrate(app: tauri::AppHandle, old_path: String, new_path: String) -> Result<(), String> {
    ai::snapshots::migrate(&app, &old_path, &new_path)
}

#[tauri::command]
fn ai_audit_append(app: tauri::AppHandle, entry: AuditEntry) -> Result<(), String> {
    ai::audit::append(&app, entry)
}

#[tauri::command]
fn ai_audit_read(app: tauri::AppHandle, since: Option<String>, until: Option<String>) -> Result<Vec<AuditEntry>, String> {
    ai::audit::read(&app, since.as_deref(), until.as_deref())
}

#[tauri::command]
fn ai_audit_clear(app: tauri::AppHandle) -> Result<(), String> {
    ai::audit::clear(&app)
}

#[tauri::command]
async fn ai_send(
    app: tauri::AppHandle,
    window: tauri::Window,
    registry: tauri::State<'_, ai::process::ChildRegistry>,
    req: ai::process::AiSendRequest,
    request_id: String,
) -> Result<String, String> {
    ai::process::spawn(app, window.label().to_string(), registry, req, request_id).await
}

#[tauri::command]
fn ai_cancel(
    app: tauri::AppHandle,
    window: tauri::Window,
    registry: tauri::State<'_, ai::process::ChildRegistry>,
    request_id: String,
) {
    ai::process::cancel(&app, window.label(), &registry, &request_id);
}

/// Persist an image (clipboard paste, drag-drop, etc.) to a temporary file
/// inside `<app_data>/ai/images/` and return its absolute path. The frontend
/// then references that path via `convertFileSrc` for previews and forwards
/// it through `AiSendRequest.images` so the backend can attach it to claude
/// or codex.
#[tauri::command]
fn ai_image_save(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
    extension: String,
) -> Result<String, String> {
    let dir = ai::paths::images_dir(&app)?;
    let safe_ext = extension.trim().trim_start_matches('.').to_ascii_lowercase();
    let allowed = matches!(safe_ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp");
    let ext = if allowed { safe_ext.as_str() } else { "png" };
    let name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    let path = dir.join(name);
    std::fs::write(&path, &bytes).map_err(|e| format!("write image failed: {}", e))?;
    Ok(path.to_string_lossy().into_owned())
}

// ============== Workspace (folder browser) commands ==============

#[derive(Serialize)]
struct WorkspaceNode {
    name: String,
    path: String,
    /// "file" or "folder"
    kind: &'static str,
    /// None for files; Some for folders (may be empty).
    children: Option<Vec<WorkspaceNode>>,
    /// Last-modified time in milliseconds since the Unix epoch (0 if unavailable).
    /// Used by the frontend to offer "sort by modified" in the workspace tree.
    modified: u64,
}

const WORKSPACE_TREE_MAX_DEPTH: usize = 50;

fn is_workspace_markdown(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".mdx")
}

fn is_workspace_image(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

fn is_workspace_visible(name: &str) -> bool {
    is_workspace_markdown(name) || is_workspace_image(name)
}

fn is_workspace_hidden(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

fn read_workspace_subtree(path: &Path, depth: usize) -> Result<WorkspaceNode, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("read metadata for {}: {}", path.display(), e))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    let path_str = path.to_string_lossy().into_owned();
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    if metadata.is_file() {
        return Ok(WorkspaceNode {
            name,
            path: path_str,
            kind: "file",
            children: None,
            modified: modified_ms,
        });
    }

    if !metadata.is_dir() {
        return Err(format!("path is neither file nor directory: {}", path.display()));
    }

    let mut children: Vec<WorkspaceNode> = Vec::new();
    if depth < WORKSPACE_TREE_MAX_DEPTH {
        let entries = std::fs::read_dir(path)
            .map_err(|e| format!("read_dir {}: {}", path.display(), e))?;
        let mut folders: Vec<PathBuf> = Vec::new();
        let mut files: Vec<PathBuf> = Vec::new();
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let entry_name = entry.file_name().to_string_lossy().into_owned();
            if is_workspace_hidden(&entry_name) {
                continue;
            }
            let entry_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if entry_type.is_dir() {
                folders.push(entry_path);
            } else if entry_type.is_file() {
                if is_workspace_visible(&entry_name) {
                    files.push(entry_path);
                }
            }
        }
        // Folders first then files, both alphabetical (case-insensitive).
        folders.sort_by_key(|p| p.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default());
        files.sort_by_key(|p| p.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default());

        for folder in folders {
            match read_workspace_subtree(&folder, depth + 1) {
                Ok(node) => children.push(node),
                Err(_) => {
                    // Skip folders we cannot read (perms, broken symlinks, etc.)
                    continue;
                }
            }
        }
        for file in files {
            if let Ok(node) = read_workspace_subtree(&file, depth + 1) {
                children.push(node);
            }
        }
    }

    Ok(WorkspaceNode {
        name,
        path: path_str,
        kind: "folder",
        children: Some(children),
        modified: modified_ms,
    })
}

#[tauri::command]
async fn read_workspace_tree(app: tauri::AppHandle, root: String) -> Result<WorkspaceNode, String> {
    let requested_path = PathBuf::from(&root);
    if !requested_path.exists() {
        return Err(format!("workspace path does not exist: {}", root));
    }
    if !requested_path.is_dir() {
        return Err(format!("workspace path is not a directory: {}", root));
    }

    // The dialog plugin grants a selected folder to the fs plugin only for the
    // current process. Restored workspaces do not pass through the dialog, and
    // on Unix the generic `**` capability deliberately excludes dot-prefixed
    // path segments. Re-grant the persisted workspace root on every tree load.
    // Canonicalization matters for visible symlinks pointing into hidden dirs:
    // plugin-fs canonicalizes a file before checking its runtime scope too.
    let scoped_path = std::fs::canonicalize(&requested_path)
        .map_err(|e| format!("canonicalize workspace {}: {}", root, e))?;
    app.fs_scope()
        .allow_directory(&scoped_path, true)
        .map_err(|e| format!("allow workspace {}: {}", root, e))?;

    // Walking a large folder is CPU/IO bound and can take seconds. Run it on
    // tokio's blocking pool so the Tauri command thread (and the renderer
    // IPC) stays responsive — the UI shows its loading state in the meantime.
    tokio::task::spawn_blocking(move || {
        read_workspace_subtree(&requested_path, 0)
    })
    .await
    .map_err(|e| format!("worker join: {}", e))?
}

#[tauri::command]
fn create_md_file(parent: String, name: String) -> Result<String, String> {
    let parent_path = Path::new(&parent);
    if !parent_path.is_dir() {
        return Err(format!("parent is not a directory: {}", parent));
    }
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("file name cannot be empty".into());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("file name cannot contain path separators".into());
    }
    let final_name = if is_workspace_markdown(trimmed) {
        trimmed.to_string()
    } else {
        format!("{}.md", trimmed)
    };
    let full = parent_path.join(&final_name);
    if full.exists() {
        return Err(format!("file already exists: {}", full.display()));
    }
    std::fs::write(&full, "").map_err(|e| format!("create file: {}", e))?;
    Ok(full.to_string_lossy().into_owned())
}

#[tauri::command]
fn create_folder(parent: String, name: String) -> Result<String, String> {
    let parent_path = Path::new(&parent);
    if !parent_path.is_dir() {
        return Err(format!("parent is not a directory: {}", parent));
    }
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("folder name cannot be empty".into());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("folder name cannot contain path separators".into());
    }
    let full = parent_path.join(trimmed);
    if full.exists() {
        return Err(format!("folder already exists: {}", full.display()));
    }
    std::fs::create_dir(&full).map_err(|e| format!("create folder: {}", e))?;
    Ok(full.to_string_lossy().into_owned())
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    let from_path = Path::new(&from);
    let to_path = Path::new(&to);
    if !from_path.exists() {
        return Err(format!("source does not exist: {}", from));
    }
    if to_path.exists() {
        return Err(format!("destination already exists: {}", to));
    }
    std::fs::rename(from_path, to_path).map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

#[derive(Serialize)]
struct ClassifiedPath {
    path: String,
    /// "file", "folder" or "missing"
    kind: &'static str,
}

fn path_kind(path: &Path) -> &'static str {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_dir() => "folder",
        Ok(meta) if meta.is_file() => "file",
        _ => "missing",
    }
}

/// Classify dropped OS paths so the frontend can tell a folder drop (add a
/// workspace) from a file drop (open a tab / insert an image).
#[tauri::command]
fn classify_paths(paths: Vec<String>) -> Vec<ClassifiedPath> {
    paths
        .into_iter()
        .map(|p| {
            let kind = path_kind(Path::new(&p));
            ClassifiedPath { path: p, kind }
        })
        .collect()
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err(format!("path does not exist: {}", path));
    }
    let metadata = std::fs::metadata(target).map_err(|e| format!("stat: {}", e))?;
    if metadata.is_dir() {
        std::fs::remove_dir_all(target).map_err(|e| format!("remove dir: {}", e))?;
    } else {
        std::fs::remove_file(target).map_err(|e| format!("remove file: {}", e))?;
    }
    Ok(())
}

// ============== Content search across open workspaces ==============

#[derive(Serialize)]
struct ContentSearchHit {
    path: String,
    /// 1-based line number where the match was found.
    line: usize,
    /// The matching line, trimmed and capped to 240 chars for display.
    snippet: String,
}

/// Substring-search the content of every `.md/.markdown/.mdx` file under any
/// of the supplied roots. Case-insensitive. Async + multi-threaded so a
/// 5000-file workspace stays interactive.
///
/// Hard limits to keep the worst case bounded:
///   - Max 5_000 files visited per call (early-stops; UI explains via `truncated`).
///   - Max 500 KB read per file (markdown is text — bigger means binary garbage).
///   - Max 200 hit lines returned overall.
///   - Total wall-clock budget: 4 s, then early-stop with whatever we have.
#[tauri::command]
async fn search_workspace_content(
    roots: Vec<String>,
    query: String,
) -> Result<Vec<ContentSearchHit>, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let q_lower = q.to_ascii_lowercase();

    tokio::task::spawn_blocking(move || -> Result<Vec<ContentSearchHit>, String> {
        let start = std::time::Instant::now();
        let budget = std::time::Duration::from_secs(4);
        const MAX_FILES: usize = 5_000;
        const MAX_FILE_BYTES: usize = 512 * 1024;
        const MAX_HITS: usize = 200;

        let mut files_visited: usize = 0;
        let mut hits: Vec<ContentSearchHit> = Vec::new();

        // Iterative DFS so we can early-stop cleanly.
        let mut stack: Vec<PathBuf> = roots
            .into_iter()
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
            .collect();

        while let Some(dir) = stack.pop() {
            if start.elapsed() > budget || hits.len() >= MAX_HITS || files_visited >= MAX_FILES {
                break;
            }
            let entries = match std::fs::read_dir(&dir) {
                Ok(rd) => rd,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if is_workspace_hidden(&name) {
                    continue;
                }
                let path = entry.path();
                let file_type = match entry.file_type() {
                    Ok(t) => t,
                    Err(_) => continue,
                };
                if file_type.is_dir() {
                    stack.push(path);
                    continue;
                }
                if !file_type.is_file() || !is_workspace_markdown(&name) {
                    continue;
                }
                files_visited += 1;
                if files_visited > MAX_FILES {
                    break;
                }
                // Read up to MAX_FILE_BYTES — markdown files are text, bigger
                // is almost certainly bad data we don't want to scan.
                let bytes = match read_file_capped(&path, MAX_FILE_BYTES) {
                    Ok(b) => b,
                    Err(_) => continue,
                };
                let text = match std::str::from_utf8(&bytes) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                for (idx, line) in text.lines().enumerate() {
                    if line.to_ascii_lowercase().contains(&q_lower) {
                        let trimmed = line.trim();
                        let snippet = if trimmed.len() > 240 {
                            format!("{}…", &trimmed.chars().take(240).collect::<String>())
                        } else {
                            trimmed.to_string()
                        };
                        hits.push(ContentSearchHit {
                            path: path.to_string_lossy().into_owned(),
                            line: idx + 1,
                            snippet,
                        });
                        if hits.len() >= MAX_HITS {
                            break;
                        }
                    }
                }
            }
        }

        Ok(hits)
    })
    .await
    .map_err(|e| format!("worker join: {}", e))?
}

fn read_file_capped(path: &Path, max_bytes: usize) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut buf = Vec::with_capacity(max_bytes.min(64 * 1024));
    let mut chunk = [0u8; 8192];
    while buf.len() < max_bytes {
        let n = f.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        let take = n.min(max_bytes - buf.len());
        buf.extend_from_slice(&chunk[..take]);
        if take < n {
            break;
        }
    }
    Ok(buf)
}

/// `Some(open target)` when `path` is a filesystem root — a drive (`C:`) or a UNC
/// share (`\\server\share`). A root cannot be selected inside a parent, and
/// `/select,` on one drops explorer at "This PC", so roots get opened directly.
#[cfg(any(test, target_os = "windows"))]
fn windows_reveal_root(path: &str) -> Option<String> {
    if let Some(rest) = path.strip_prefix(r"\\") {
        let mut parts = rest.split('\\').filter(|s| !s.is_empty());
        let server = parts.next()?;
        let share = parts.next();
        if parts.next().is_some() {
            return None;
        }
        return Some(match share {
            Some(share) => format!(r"\\{}\{}", server, share),
            None => format!(r"\\{}", server),
        });
    }

    let bytes = path.as_bytes();
    if bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Some(format!("{}\\", path));
    }
    None
}

/// Build the raw `explorer.exe` command line for revealing `path` (#125).
///
/// This has to bypass `Command::arg`: std wraps any argument containing a space
/// in quotes, and explorer parses the resulting `"/select,C:\a b\c.md"` as a path
/// rather than a switch, then silently falls back to the user's Documents folder.
/// Explorer also only understands backslashes — a `C:/…` path lands it on "This PC".
#[cfg(any(test, target_os = "windows"))]
fn windows_reveal_arg(path: &str) -> String {
    let normalized = path.replace('/', "\\");
    let target = normalized.trim_end_matches('\\');
    match windows_reveal_root(target) {
        Some(root) => format!("\"{}\"", root),
        None => format!("/select,\"{}\"", target),
    }
}

/// Reveal a file or folder in the host OS file manager.
/// On Windows uses `explorer /select,"<path>"`; on macOS uses `open -R <path>`;
/// on Linux falls back to opening the parent folder via xdg-open.
#[tauri::command]
fn reveal_in_os(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err(format!("path does not exist: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .raw_arg(windows_reveal_arg(&path))
            .spawn()
            .map_err(|e| format!("explorer: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("open: {}", e))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = target
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        std::process::Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| format!("xdg-open: {}", e))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("reveal_in_os: unsupported platform".into())
}

/// Open a file with the host OS default handler (used for .eml feedback drafts).
#[tauri::command]
fn open_in_os(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err(format!("path does not exist: {}", path));
    }
    if !target.is_file() {
        return Err(format!("path is not a file: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Avoid a flashing console window around `cmd /C start`.
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let normalized = path.replace('/', "\\");
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &normalized])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("start: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("open: {}", e))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("xdg-open: {}", e))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("open_in_os: unsupported platform".into())
}

/// List all font family names installed on the system.
/// Returns a sorted, deduplicated list of font family names.
#[tauri::command]
fn list_system_fonts() -> Vec<String> {
    let source = SystemSource::new();
    let mut families = BTreeSet::new();

    if let Ok(all_fonts) = source.all_families() {
        for family in all_fonts {
            // Skip hidden/internal fonts (starting with . or #)
            if !family.starts_with('.') && !family.starts_with('#') {
                families.insert(family);
            }
        }
    }

    families.into_iter().collect()
}

#[tauri::command]
async fn create_new_window(
    app: tauri::AppHandle,
    file_path: Option<String>,
    defer_open: Option<bool>,
) -> Result<String, String> {
    let window_id = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let window_label = format!("window-{}", window_id);

    let defer_open = defer_open.unwrap_or(false);
    let url = if defer_open {
        "index.html?transfer=1".to_string()
    } else {
        match &file_path {
            Some(path) => {
                let encoded_path = urlencoding::encode(path);
                format!("index.html?file={}", encoded_path)
            }
            None => "index.html".to_string(),
        }
    };

    let window = WebviewWindowBuilder::new(
        &app,
        &window_label,
        WebviewUrl::App(url.into())
    )
    .title("MerMark Editor")
    .inner_size(1200.0, 800.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|e| e.to_string())?;

    let focus_result = window.set_focus();
    if !defer_open {
        focus_result.map_err(|e| e.to_string())?;
    }

    Ok(window_label)
}

#[cfg(any(test, target_os = "linux"))]
#[derive(Clone, Copy)]
struct StartupEnvOverride {
    key: &'static str,
    value: &'static str,
}

// Helps with rendering glitches on fragile GPU stacks (NVIDIA, VMs) where EGL
// itself works. NOTE: these vars cannot prevent the `Could not create default
// EGL display: EGL_BAD_PARAMETER` abort from #106 — since WebKitGTK 2.46 the
// WebProcess initializes its EGL display before the preference store is applied
// (WebPage.cpp: drawingArea->updatePreferences runs ahead of updatePreferences),
// so the abort is reachable regardless. The actual #106 fix is in release.yml:
// the AppImage must not bundle libwayland-client.so.0.
#[cfg(any(test, target_os = "linux"))]
const LINUX_WEBKIT_RENDER_OVERRIDES: [StartupEnvOverride; 2] = [
    StartupEnvOverride { key: "WEBKIT_DISABLE_DMABUF_RENDERER", value: "1" },
    StartupEnvOverride { key: "WEBKIT_DISABLE_COMPOSITING_MODE", value: "1" },
];

// Inject an override only when the user has not already set a meaningful value,
// so an explicit `WEBKIT_DISABLE_*` from the environment stays authoritative.
#[cfg(any(test, target_os = "linux"))]
fn should_apply_webkit_override(current: Option<&std::ffi::OsStr>) -> bool {
    match current {
        Some(value) => value.to_string_lossy().trim().is_empty(),
        None => true,
    }
}

// Must run before the first webview spawns and while still single-threaded
// (top of `run`), since `set_var` is only sound before other threads read env.
#[cfg(any(test, target_os = "linux"))]
fn apply_linux_webkit_overrides() {
    for ov in LINUX_WEBKIT_RENDER_OVERRIDES {
        if should_apply_webkit_override(std::env::var_os(ov.key).as_deref()) {
            std::env::set_var(ov.key, ov.value);
        }
    }
}

// The AppImage AppRun hook shipped by linuxdeploy-plugin-gtk used to pin
// `GDK_BACKEND=x11`, so a GNOME/Wayland session got XWayland and its resize bugs
// (#126). release.yml now strips that line, and the preference is pinned here so
// it no longer depends on the compiled-in backend order of whichever GTK build a
// distro package links against. `wayland,x11` keeps the X11 fallback for
// sessions where the Wayland backend cannot connect.
#[cfg(any(test, target_os = "linux"))]
const LINUX_WAYLAND_GDK_BACKEND: &str = "wayland,x11";

#[cfg(any(test, target_os = "linux"))]
fn wayland_gdk_backend(
    gdk_backend: Option<&std::ffi::OsStr>,
    wayland_display: Option<&std::ffi::OsStr>,
    session_type: Option<&std::ffi::OsStr>,
) -> Option<&'static str> {
    let user_pinned_backend = gdk_backend
        .map(|v| !v.to_string_lossy().trim().is_empty())
        .unwrap_or(false);
    if user_pinned_backend {
        return None;
    }
    let has_wayland_socket = wayland_display
        .map(|v| !v.to_string_lossy().trim().is_empty())
        .unwrap_or(false);
    let is_wayland_session = session_type
        .map(|v| v.to_string_lossy().trim().eq_ignore_ascii_case("wayland"))
        .unwrap_or(false);

    (has_wayland_socket || is_wayland_session).then_some(LINUX_WAYLAND_GDK_BACKEND)
}

#[cfg(any(test, target_os = "linux"))]
fn apply_linux_gdk_backend() {
    if let Some(backend) = wayland_gdk_backend(
        std::env::var_os("GDK_BACKEND").as_deref(),
        std::env::var_os("WAYLAND_DISPLAY").as_deref(),
        std::env::var_os("XDG_SESSION_TYPE").as_deref(),
    ) {
        std::env::set_var("GDK_BACKEND", backend);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    apply_linux_webkit_overrides();
    #[cfg(target_os = "linux")]
    apply_linux_gdk_backend();

    tauri::Builder::default()
        .register_uri_scheme_protocol(PRINT_SCHEME, |ctx, _request| {
            let html = ctx
                .app_handle()
                .state::<PrintHtmlState>()
                .0
                .lock()
                .unwrap()
                .clone()
                .unwrap_or_default();
            tauri::http::Response::builder()
                .header("Content-Type", "text/html; charset=utf-8")
                .body(html.into_bytes())
                .unwrap()
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // When another instance is launched with arguments (file association)
            // Send the file path to the existing window
            if let Some(window) = app.get_webview_window("main") {
                // Bring window to front even if minimized (#49)
                if window.is_minimized().unwrap_or(false) {
                    let _ = window.unminimize();
                }
                if !window.is_visible().unwrap_or(true) {
                    let _ = window.show();
                }
                let _ = window.set_focus();

                if args.len() > 1 {
                    let file_path = &args[1];
                    if is_supported_markdown_path(file_path) {
                        let _ = window.emit("open-file", file_path.clone());
                    }
                }
            }
        }))
        .manage(OpenFileState(Mutex::new(None)))
        .manage(OpenFilesRegistry(Mutex::new(OpenFileRegistryState::default())))
        .on_page_load(|webview, payload| {
            if webview.label() == PRINT_WINDOW_LABEL
                || !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                return;
            }
            let registry = webview.state::<OpenFilesRegistry>();
            if let Ok(instance) = frontend_loaded(&registry, webview.window().label()) {
                let instance = serde_json::to_string(&instance).expect("UUID serialization");
                let _ = webview.eval(format!(
                    "window.__mermarkFileOpeningInstance = {instance}; window.dispatchEvent(new Event('mermark-file-opening-ready'));"
                ));
            }
        })
        .manage(PrintHtmlState(Mutex::new(None)))
        .manage(ai::process::ChildRegistry::new())
        .invoke_handler(tauri::generate_handler![
            get_open_file_path,
            create_new_window,
            get_all_windows,
            get_current_window_label,
            print_document,
            transfer_tab_to_window,
            register_open_file,
            reserve_save_target,
            finish_save_target,
            unregister_open_file,
            unregister_window_files,
            check_file_open,
            focus_window_with_file,
            list_system_fonts,
            read_workspace_tree,
            create_md_file,
            create_folder,
            rename_path,
            delete_path,
            classify_paths,
            reveal_in_os,
            open_in_os,
            search_workspace_content,
            ai_health_check,
            ai_ollama_models,
            ai_openai_models,
            ai_codex_models,
            ai_access_load,
            ai_access_save,
            ai_access_migrate,
            ai_session_get,
            ai_session_upsert,
            ai_session_remove,
            ai_session_migrate,
            ai_session_recover_by_hash,
            ai_snapshot_list,
            ai_snapshot_create,
            ai_snapshot_restore,
            ai_snapshot_set_pinned,
            ai_snapshot_delete,
            ai_snapshot_export,
            ai_snapshot_migrate,
            ai_audit_append,
            ai_audit_read,
            ai_audit_clear,
            ai_send,
            ai_cancel,
            ai_image_save
        ])
        .setup(|app| {
            // Check for CLI arguments (file association on first launch)
            let args: Vec<String> = std::env::args().collect();
            if args.len() > 1 {
                let file_path = &args[1];
                if is_supported_markdown_path(file_path) {
                    // Store the file path to be retrieved by frontend
                    let state = app.state::<OpenFileState>();
                    *state.0.lock().unwrap() = Some(file_path.clone());
                }
            }

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                RunEvent::ExitRequested { .. } => {
                    if let Some(reg) = app.try_state::<ai::process::ChildRegistry>() {
                        reg.kill_all();
                    }
                }
                #[cfg(target_os = "macos")]
                RunEvent::Opened { urls } => {
                    // macOS: Finder double-click on already-running app dispatches
                    // NSApplicationDelegate application:openURLs: (no new process,
                    // so single_instance plugin never fires). Handle it here. (#63)
                    let file_paths: Vec<String> = urls
                        .into_iter()
                        .filter_map(|url| url.to_file_path().ok())
                        .map(|path| path.to_string_lossy().to_string())
                        .filter(|path| is_supported_markdown_path(path))
                        .collect();

                    if file_paths.is_empty() {
                        return;
                    }

                    // Always persist the pending file before touching the window.
                    // On cold start macOS can deliver Opened before the webview is
                    // ready, and the frontend later retrieves this value.
                    let state = app.state::<OpenFileState>();
                    *state.0.lock().unwrap() = file_paths.last().cloned();

                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_minimized().unwrap_or(false) {
                            let _ = window.unminimize();
                        }
                        if !window.is_visible().unwrap_or(true) {
                            let _ = window.show();
                        }
                        let _ = window.set_focus();

                        for path in file_paths {
                            let _ = window.emit("open-file", path);
                        }
                    }
                }
                RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { api, .. }, .. } => {
                    // The print helper window is auxiliary — never let it gate app lifecycle.
                    if label == PRINT_WINDOW_LABEL {
                        return;
                    }
                    let editor_windows = app
                        .webview_windows()
                        .keys()
                        .filter(|l| *l != PRINT_WINDOW_LABEL)
                        .count();
                    if editor_windows <= 1 {
                        return;
                    }
                    if let Some(window) = app.get_webview_window(&label) {
                        let _ = window.destroy();
                    }
                    api.prevent_close();
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    #[test]
    fn webkit_override_applies_when_unset_or_blank() {
        assert!(should_apply_webkit_override(None));
        assert!(should_apply_webkit_override(Some(OsStr::new(""))));
        assert!(should_apply_webkit_override(Some(OsStr::new("   "))));
    }

    #[test]
    fn webkit_override_respects_explicit_user_value() {
        assert!(!should_apply_webkit_override(Some(OsStr::new("1"))));
        assert!(!should_apply_webkit_override(Some(OsStr::new("0"))));
    }

    #[test]
    fn classify_paths_separates_folders_files_and_missing() {
        let dir = std::env::temp_dir().join(format!("mermark-classify-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "x").unwrap();
        let missing = dir.join("gone.md");

        let out = classify_paths(vec![
            dir.to_string_lossy().into_owned(),
            file.to_string_lossy().into_owned(),
            missing.to_string_lossy().into_owned(),
        ]);

        let kinds: Vec<&str> = out.iter().map(|e| e.kind).collect();
        assert_eq!(kinds, ["folder", "file", "missing"]);
        assert_eq!(out[1].path, file.to_string_lossy());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_paths_preserves_input_order_and_length() {
        let out = classify_paths(vec!["/definitely/not/here".into(), "/nor/here".into()]);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].path, "/definitely/not/here");
        assert!(out.iter().all(|e| e.kind == "missing"));
    }

    #[test]
    fn linux_webkit_overrides_target_known_egl_workaround_vars() {
        let keys: Vec<&str> = LINUX_WEBKIT_RENDER_OVERRIDES.iter().map(|o| o.key).collect();
        assert_eq!(
            keys,
            ["WEBKIT_DISABLE_DMABUF_RENDERER", "WEBKIT_DISABLE_COMPOSITING_MODE"]
        );
        assert!(LINUX_WEBKIT_RENDER_OVERRIDES.iter().all(|o| o.value == "1"));
        // Symbol must build on every platform so the Linux applier is type-checked in CI.
        let _f: fn() = apply_linux_webkit_overrides;
    }

    #[test]
    fn reveal_arg_quotes_the_path_not_the_whole_switch() {
        assert_eq!(
            windows_reveal_arg(r"C:\Users\edy\My Notes\a.md"),
            "/select,\"C:\\Users\\edy\\My Notes\\a.md\""
        );
        assert_eq!(
            windows_reveal_arg(r"C:\notes\a.md"),
            "/select,\"C:\\notes\\a.md\""
        );
    }

    #[test]
    fn reveal_arg_normalizes_forward_slashes() {
        assert_eq!(
            windows_reveal_arg("C:/Users/edy/My Notes/a.md"),
            "/select,\"C:\\Users\\edy\\My Notes\\a.md\""
        );
    }

    #[test]
    fn open_in_os_rejects_missing_path() {
        let err = open_in_os("C:\\definitely\\missing-mermark.eml".into()).unwrap_err();
        assert!(err.contains("does not exist"), "{err}");
    }

    #[test]
    fn open_in_os_rejects_a_directory() {
        let dir = std::env::temp_dir();
        let err = open_in_os(dir.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("not a file"), "{err}");
    }

    #[test]
    fn reveal_arg_keeps_unc_paths_intact() {
        assert_eq!(
            windows_reveal_arg(r"\\server\share\notes\a.md"),
            "/select,\"\\\\server\\share\\notes\\a.md\""
        );
        assert_eq!(
            windows_reveal_arg("//server/share/notes/a.md"),
            "/select,\"\\\\server\\share\\notes\\a.md\""
        );
    }

    #[test]
    fn reveal_arg_opens_roots_instead_of_selecting_them() {
        assert_eq!(windows_reveal_arg(r"C:\"), "\"C:\\\"");
        assert_eq!(windows_reveal_arg("C:"), "\"C:\\\"");
        assert_eq!(windows_reveal_arg("d:/"), "\"d:\\\"");
        assert_eq!(windows_reveal_arg(r"\\server\share"), "\"\\\\server\\share\"");
        assert_eq!(windows_reveal_arg("//server/share/"), "\"\\\\server\\share\"");
    }

    #[test]
    fn reveal_arg_drops_trailing_separator_on_folders() {
        // A trailing `\` before the closing quote would read as an escaped quote.
        assert_eq!(
            windows_reveal_arg(r"C:\Users\edy\My Notes\"),
            "/select,\"C:\\Users\\edy\\My Notes\""
        );
    }

    #[test]
    fn reveal_arg_preserves_non_ascii_names() {
        assert_eq!(
            windows_reveal_arg(r"C:\Notatki\zażółć gęślą jaźń.md"),
            "/select,\"C:\\Notatki\\zażółć gęślą jaźń.md\""
        );
    }

    #[test]
    fn reveal_root_rejects_paths_below_a_share() {
        assert_eq!(windows_reveal_root(r"\\server\share\notes"), None);
        assert_eq!(windows_reveal_root(r"C:\notes"), None);
    }

    #[test]
    fn gdk_backend_prefers_wayland_when_socket_is_present() {
        assert_eq!(
            wayland_gdk_backend(None, Some(OsStr::new("wayland-0")), None),
            Some("wayland,x11")
        );
    }

    #[test]
    fn gdk_backend_prefers_wayland_for_wayland_session_type() {
        assert_eq!(
            wayland_gdk_backend(None, None, Some(OsStr::new("Wayland"))),
            Some("wayland,x11")
        );
    }

    #[test]
    fn gdk_backend_untouched_without_wayland_session() {
        assert_eq!(wayland_gdk_backend(None, None, None), None);
        assert_eq!(
            wayland_gdk_backend(None, Some(OsStr::new("  ")), Some(OsStr::new("x11"))),
            None
        );
    }

    #[test]
    fn gdk_backend_respects_explicit_user_value() {
        assert_eq!(
            wayland_gdk_backend(
                Some(OsStr::new("x11")),
                Some(OsStr::new("wayland-0")),
                Some(OsStr::new("wayland"))
            ),
            None
        );
        assert_eq!(
            wayland_gdk_backend(
                Some(OsStr::new("broadway")),
                Some(OsStr::new("wayland-0")),
                None
            ),
            None
        );
    }

    #[test]
    fn gdk_backend_applies_over_blank_value_and_keeps_x11_fallback() {
        assert_eq!(
            wayland_gdk_backend(Some(OsStr::new("   ")), Some(OsStr::new("wayland-0")), None),
            Some("wayland,x11")
        );
        assert!(LINUX_WAYLAND_GDK_BACKEND.ends_with(",x11"));
        // Symbol must build on every platform so the Linux applier is type-checked in CI.
        let _f: fn() = apply_linux_gdk_backend;
    }
}
