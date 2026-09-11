// ABOUTME: Classifies AI tool calls as quiet activity vs file edits.
// ABOUTME: Lets the chat hide shell/grep noise and show Cursor-like change cards.

export type AiToolKind = 'activity' | 'edit' | 'other';

const ACTIVITY_TOOLS = new Set([
  'read',
  'glob',
  'grep',
  'bash',
  'shell',
  'websearch',
  'webfetch',
  'webbrowser',
  'list_dir',
  'read_file',
  'search_files',
  'ls',
  'find',
]);

const EDIT_TOOLS = new Set([
  'write',
  'edit',
  'write_file',
  'edit_file',
  'applypatch',
  'apply_patch',
  'strreplace',
  'str_replace',
  'file_change',
]);

function normalizeToolName(tool: string): string {
  return tool.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function classifyAiTool(tool: string | undefined): AiToolKind {
  if (!tool) return 'other';
  const name = normalizeToolName(tool);
  if (ACTIVITY_TOOLS.has(name)) return 'activity';
  if (EDIT_TOOLS.has(name)) return 'edit';
  return 'other';
}

const PATH_KEYS = ['file_path', 'path', 'target_file', 'file', 'filename'];
const PATCH_FILE_RE = /^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$/m;
const UNIFIED_NEW_RE = /^\+\+\+ (?:b\/)?(.+)$/m;

function pathFromPatchText(text: string): string | null {
  const patch = text.match(PATCH_FILE_RE);
  if (patch?.[1]) return patch[1].trim();
  const unified = text.match(UNIFIED_NEW_RE);
  if (unified?.[1] && unified[1] !== '/dev/null') return unified[1].trim();
  return null;
}

/**
 * Tool args arrive as an object, a JSON string, a nested JSON string, or a
 * raw apply_patch blob. Unwrap those shapes so path/diff parsers share one path.
 */
export function coerceToolArgs(args: unknown): Record<string, unknown> | string | null {
  if (args == null) return null;
  if (typeof args === 'string') {
    const trimmed = args.trim();
    if (!trimmed) return null;
    try {
      return coerceToolArgs(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }
  if (typeof args !== 'object' || Array.isArray(args)) return null;
  const rec = args as Record<string, unknown>;
  if (typeof rec._raw === 'string' && Object.keys(rec).length === 1) {
    return coerceToolArgs(rec._raw);
  }
  return rec;
}

/** Pull a file path out of a tool-args object, JSON string, or patch blob. */
export function extractToolFilePath(args: unknown): string | null {
  const coerced = coerceToolArgs(args);
  if (coerced == null) return null;
  if (typeof coerced === 'string') return pathFromPatchText(coerced);

  for (const key of PATH_KEYS) {
    const v = coerced[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  for (const key of ['input', 'patch', 'diff']) {
    const v = coerced[key];
    if (typeof v === 'string') {
      const fromPatch = pathFromPatchText(v);
      if (fromPatch) return fromPatch;
    }
  }
  if (typeof coerced.changes === 'string') {
    const fromPatch = pathFromPatchText(coerced.changes);
    if (fromPatch) return fromPatch;
  }
  if (Array.isArray(coerced.changes)) {
    for (const item of coerced.changes) {
      const nested = extractToolFilePath(item);
      if (nested) return nested;
    }
  } else if (coerced.changes && typeof coerced.changes === 'object') {
    for (const [key, value] of Object.entries(coerced.changes as Record<string, unknown>)) {
      if (key.includes('.') || key.includes('/') || key.includes('\\')) return key;
      const nested = extractToolFilePath(value);
      if (nested) return nested;
    }
  }
  return null;
}

export function fileNameFromPath(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(i + 1) : path;
}
