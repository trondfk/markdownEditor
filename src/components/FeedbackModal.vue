<!-- ABOUTME: In-app bug report form that copies diagnostics and opens GitHub or email.
     ABOUTME: No token; screenshots travel via clipboard, a folder, or an .eml draft. -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { useI18n } from '../i18n';
import { useAi } from '../composables/useAi';
import { aiCommands } from '../services/aiCommands';
import { IMAGE_EXTS, MAX_IMAGE_BYTES } from '../composables/useAiPendingImages';
import { readShrinkLogTail } from '../utils/save-audit';
import {
  FEEDBACK_EMAIL,
  buildDiagnosticText,
  buildEml,
  buildGitHubIssueUrl,
  buildIssueBody,
  buildMailtoUrl,
} from '../utils/feedback-report';

interface Shot {
  id: string;
  blob: Blob;
  blobUrl: string;
  name: string;
  mime: string;
}

const { t } = useI18n();
const ai = useAi();

const emit = defineEmits<{ close: [] }>();

const title = ref('');
const body = ref('');
const includeDiag = ref(true);
const copied = ref(false);
const copiedKind = ref<'issue' | 'email' | 'shots' | 'copy'>('copy');
const appVersion = ref('');
const shots = ref<Shot[]>([]);
const MAX_SHOTS = 5;

onMounted(async () => {
  try {
    appVersion.value = await getVersion();
  } catch {
    appVersion.value = '?';
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('paste', onWindowPaste);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('paste', onWindowPaste);
  for (const s of shots.value) URL.revokeObjectURL(s.blobUrl);
});

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}

function copiedMessage(): string {
  if (copiedKind.value === 'email') return t.value.reportFeedbackCopiedEmail;
  if (copiedKind.value === 'shots') return t.value.reportFeedbackCopiedWithShots;
  return t.value.reportFeedbackCopied;
}

async function diagnostics(): Promise<string> {
  const lastErr = [...ai.messages.value].reverse().find(m => m.error)?.error ?? null;
  let auditTail: Array<{ ts: string; cli: string; action: string; exitCode: number | null }> = [];
  try {
    const rows = await aiCommands.auditRead(null, null);
    auditTail = rows.slice(-20).map(r => ({
      ts: r.ts,
      cli: r.cli,
      action: r.action,
      exitCode: r.exitCode,
    }));
  } catch {
    auditTail = [];
  }
  let saveAuditTail: Array<{ ts: string; trigger: string; lostChars: number }> = [];
  try {
    const rows = await readShrinkLogTail(10);
    saveAuditTail = rows.map(r => ({ ts: r.ts, trigger: r.trigger, lostChars: r.lostChars }));
  } catch {
    saveAuditTail = [];
  }
  return buildDiagnosticText({
    appVersion: appVersion.value,
    os: navigator.platform || navigator.userAgent,
    cli: ai.activeThread.value?.cli ?? null,
    model: ai.activeThread.value?.model ?? null,
    lastAiError: lastErr,
    auditTail,
    saveAuditTail,
    userTitle: title.value,
    userBody: body.value,
  });
}

function addShot(file: Blob, name?: string) {
  if (shots.value.length >= MAX_SHOTS) return;
  if (file.size > MAX_IMAGE_BYTES) {
    window.alert(`Image too large (${Math.round(file.size / 1024 / 1024)} MB). Max ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
    return;
  }
  const mime = file.type || 'image/png';
  if (!mime.startsWith('image/')) return;
  const rawExt = mime.split('/')[1]?.toLowerCase() ?? 'png';
  const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
  const fallback = `screenshot-${shots.value.length + 1}.${ext}`;
  const base = (name ?? fallback).split(/[/\\]/).pop() || fallback;
  shots.value.push({
    id: crypto.randomUUID(),
    blob: file,
    blobUrl: URL.createObjectURL(file),
    name: base.replace(/[<>:"|?*]/g, '_') || fallback,
    mime,
  });
}

function removeShot(id: string) {
  const idx = shots.value.findIndex(s => s.id === id);
  if (idx < 0) return;
  URL.revokeObjectURL(shots.value[idx].blobUrl);
  shots.value.splice(idx, 1);
}

function addImageFiles(files: File[]) {
  for (const f of files) {
    if (f.type.startsWith('image/')) addShot(f, f.name);
  }
}

function onWindowPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length === 0) return;
  e.preventDefault();
  addImageFiles(files);
}

function onDrop(e: DragEvent) {
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  e.preventDefault();
  addImageFiles(Array.from(files));
}

async function pickScreenshot() {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: true,
    filters: [{ name: 'Images', extensions: [...IMAGE_EXTS] }],
  });
  if (!selected) return;
  const paths = Array.isArray(selected) ? selected : [selected];
  const { readFile } = await import('@tauri-apps/plugin-fs');
  for (const p of paths) {
    try {
      const bytes = await readFile(p);
      const ext = (p.split(/[.]/).pop() || 'png').toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      const blob = new Blob([bytes], { type: mime });
      const name = p.split(/[/\\]/).pop() || 'screenshot.png';
      addShot(blob, name);
    } catch (err) {
      console.error('[FeedbackModal] pickScreenshot read failed:', err);
    }
  }
}

async function copyReport(diag: string | null): Promise<void> {
  const text = [title.value, body.value, diag].filter(Boolean).join('\n\n');
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
  } catch (e) {
    console.error('[FeedbackModal] clipboard failed:', e);
  }
}

async function reportText(withDiag: boolean): Promise<{ diag: string | null; text: string }> {
  const diag = withDiag ? await diagnostics() : null;
  const text = [title.value, body.value, diag].filter(Boolean).join('\n\n');
  return { diag, text };
}

async function writeShotBundle(report?: string): Promise<{ dir: string; firstPath: string | null }> {
  const { tempDir, join } = await import('@tauri-apps/api/path');
  const { mkdir, writeFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
  const dir = await join(await tempDir(), 'mermark-feedback', String(Date.now()));
  await mkdir(dir, { recursive: true });
  if (report) await writeTextFile(await join(dir, 'rapport.txt'), report);
  let firstPath: string | null = null;
  for (const s of shots.value) {
    const bytes = new Uint8Array(await s.blob.arrayBuffer());
    const path = await join(dir, s.name);
    await writeFile(path, bytes);
    if (!firstPath) firstPath = path;
  }
  return { dir, firstPath };
}

async function onCopy() {
  const { diag } = await reportText(includeDiag.value);
  await copyReport(diag);
  copiedKind.value = 'copy';
}

async function onOpenIssue() {
  const { diag, text } = await reportText(includeDiag.value);
  await copyReport(diag);
  let shotNote = shots.value.length;
  if (shots.value.length > 0) {
    try {
      const { firstPath } = await writeShotBundle(text);
      if (firstPath) await invoke('reveal_in_os', { path: firstPath });
      copiedKind.value = 'shots';
    } catch (e) {
      console.error('[FeedbackModal] screenshot folder failed:', e);
      copiedKind.value = 'issue';
      shotNote = 0;
    }
  } else {
    copiedKind.value = 'issue';
  }
  const issueBody = buildIssueBody({
    appVersion: appVersion.value,
    os: navigator.platform || navigator.userAgent,
    auditTail: [],
    saveAuditTail: [],
    userTitle: title.value,
    userBody: body.value,
  }, diag, shotNote);
  await openExternal(buildGitHubIssueUrl(title.value, issueBody));
}

async function onOpenEmail() {
  const { diag, text } = await reportText(includeDiag.value);
  await copyReport(diag);
  const subject = title.value.trim() || 'Bug report from MerMark';
  if (shots.value.length === 0) {
    copiedKind.value = 'email';
    await openExternal(buildMailtoUrl(FEEDBACK_EMAIL, subject, text));
    return;
  }
  try {
    const { dir } = await writeShotBundle(text);
    const attachments = await Promise.all(shots.value.map(async s => ({
      filename: s.name,
      mime: s.mime,
      bytes: new Uint8Array(await s.blob.arrayBuffer()),
    })));
    const eml = buildEml({
      to: FEEDBACK_EMAIL,
      subject,
      body: text,
      attachments,
    });
    const { join } = await import('@tauri-apps/api/path');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const emlPath = await join(dir, 'mermark-feedback.eml');
    await writeFile(emlPath, new TextEncoder().encode(eml));
    await invoke('open_in_os', { path: emlPath });
    copiedKind.value = 'shots';
  } catch (e) {
    console.error('[FeedbackModal] eml draft failed:', e);
    copiedKind.value = 'email';
    await openExternal(buildMailtoUrl(FEEDBACK_EMAIL, subject, text));
  }
}
</script>

<template>
  <div class="fb-overlay" @click.self="emit('close')">
    <div
      class="fb-panel"
      role="dialog"
      :aria-label="t.reportFeedbackTitle"
      @dragover.prevent
      @drop="onDrop"
    >
      <header class="fb-head">
        <h3>{{ t.reportFeedbackTitle }}</h3>
        <button type="button" class="fb-close" @click="emit('close')">{{ t.close }}</button>
      </header>
      <label class="fb-field">
        <span>{{ t.reportFeedbackSubject }}</span>
        <input v-model="title" type="text" />
      </label>
      <label class="fb-field">
        <span>{{ t.reportFeedbackWhatHappened }}</span>
        <textarea v-model="body" rows="5" />
      </label>
      <div class="fb-shots">
        <div class="fb-shots-head">
          <span>{{ t.reportFeedbackScreenshots }}</span>
          <button type="button" @click="pickScreenshot">{{ t.reportFeedbackAddScreenshot }}</button>
        </div>
        <p class="fb-shots-hint">{{ t.reportFeedbackPasteHint }}</p>
        <ul v-if="shots.length > 0" class="fb-thumbs">
          <li v-for="s in shots" :key="s.id">
            <img :src="s.blobUrl" :alt="s.name" />
            <button type="button" class="fb-thumb-rm" :title="t.reportFeedbackRemoveScreenshot" @click="removeShot(s.id)">×</button>
          </li>
        </ul>
      </div>
      <label class="fb-check">
        <input v-model="includeDiag" type="checkbox" />
        <span>{{ t.reportFeedbackIncludeDiag }}</span>
      </label>
      <p class="fb-privacy">{{ t.reportFeedbackPrivacy }}</p>
      <p v-if="copied" class="fb-copied">{{ copiedMessage() }}</p>
      <div class="fb-actions">
        <button type="button" @click="onCopy">{{ t.reportFeedbackCopy }}</button>
        <button type="button" @click="onOpenEmail">{{ t.reportFeedbackEmail }}</button>
        <button type="button" class="fb-primary" @click="onOpenIssue">{{ t.reportFeedbackOpenIssue }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fb-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.35);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}
.fb-panel {
  width: min(540px, 92vw);
  max-height: 90vh;
  overflow: auto;
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.fb-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.fb-head h3 { margin: 0; }
.fb-close {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
}
.fb-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.fb-field input,
.fb-field textarea {
  background: var(--bg-input, var(--bg-secondary));
  color: var(--text-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  padding: 6px 8px;
  font: inherit;
}
.fb-shots {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px dashed var(--border-primary);
  border-radius: 6px;
  background: var(--bg-secondary);
}
.fb-shots-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}
.fb-shots-head button {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border-primary);
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
}
.fb-shots-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}
.fb-thumbs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.fb-thumbs li {
  position: relative;
  width: 64px;
  height: 64px;
}
.fb-thumbs img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--border-primary);
}
.fb-thumb-rm {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--border-primary);
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  line-height: 1;
  padding: 0;
}
.fb-check {
  display: flex;
  gap: 8px;
  font-size: 13px;
  align-items: flex-start;
}
.fb-privacy, .fb-copied {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
}
.fb-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.fb-actions button {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-primary);
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
}
.fb-primary {
  background: var(--primary) !important;
  color: #fff !important;
  border-color: var(--primary) !important;
}
</style>
