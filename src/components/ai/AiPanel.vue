<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { htmlToMarkdown } from '../../utils/markdown-converter';
import { useI18n } from '../../i18n';
import { useSettings, PROJECT_INSTRUCTIONS_MAX, clampAiInstructions, type CliKind } from '../../composables/useSettings';
import { useAi } from '../../composables/useAi';
import { useAiSession } from '../../composables/useAiSession';
import { useAiAccessMap } from '../../composables/useAiAccessMap';
import { useAiHealth } from '../../composables/useAiHealth';
import { useAiContext } from '../../composables/useAiContext';
import { modelsFor, effortsFor, useAiModels } from '../../composables/useAiModels';
import { aiCommands } from '../../services/aiCommands';
import { useAiPanelLayout } from '../../composables/useAiPanelLayout';
import { useAiToolToast } from '../../composables/useAiToolToast';
import { useAiPinnedSelections } from '../../composables/useAiPinnedSelections';
import { useAiPendingImages, type PendingImage } from '../../composables/useAiPendingImages';
import { buildDocAttachment, buildStaticPreamble, buildTurnContext, hashPreamble, shouldSendStaticPreamble, type AttachedRef, type PreambleOptions } from '../../composables/useAiPreamble';
import { buildSummaryPrompt, shouldCompact } from '../../utils/ai-compaction';
import { useAiMermaidTarget, extractMermaidCodeFromResponse } from '../../composables/useAiMermaidTarget';
import { accessMapForSend } from '../../composables/useAiWorkspaceContext';
import { buildMermaidBlockFor } from '../../utils/mermaid-formats';
import { resolveMermaidWriteFormat, resolveMermaidReadFormats } from '../../composables/useSettings';
import { capDocImages, extractLocalImageRefs, isWithinImageBudget, MAX_DOC_IMAGES_PER_TURN } from '../../utils/ai-doc-images';
import { classifyAiTool, extractToolFilePath } from '../../utils/ai-tool-kind';
import { diffFromToolArgs, preferFileDiff, type ChangeDiff } from '../../utils/ai-change-diff';
import { generateDiff } from '../../composables/useDiffPreview';
import { ATTACHED_EXCERPT_MAX, flattenMentions, type MentionItem } from '../../utils/ai-mentions';
import { workspaceFs } from '../../services/workspaceFs';
import AiPanelTab from './AiPanelTab.vue';
import AiPanelHeader from './AiPanelHeader.vue';
import AiPanelModelPicker from './AiPanelModelPicker.vue';
import AiPanelContextBar from './AiPanelContextBar.vue';
import AiPanelStatusNotices from './AiPanelStatusNotices.vue';
import AiPanelMessages from './AiPanelMessages.vue';
import AiPanelComposer from './AiPanelComposer.vue';
import AiPanelModeChips from './AiPanelModeChips.vue';
import AiPanelGearSheet from './AiPanelGearSheet.vue';
import AiAttachmentModal from './AiAttachmentModal.vue';
import AiImagePreview from './AiImagePreview.vue';
import AiToolToast from './AiToolToast.vue';
import ResizeDivider from '../ResizeDivider.vue';

const props = defineProps<{
  open: boolean;
  docPath: string;
  docContent: string;
  selectionRange: { start: number; end: number } | null;
  selectionText?: string;
  workDir: string;
  /** Optional name of the workspace owning the active file (for AI context). */
  workspaceName?: string;
  /** Optional absolute root path of the workspace (for AI context). */
  workspaceRoot?: string;
}>();

const emit = defineEmits<{
  close: [];
  applyContent: [content: string];
  showDiff: [orig: string, candidate: string];
  linkClick: [url: string];
  reportFeedback: [];
}>();

const { t } = useI18n();
const { settings, setAiDefaultCli, setAiDefaultModelClaude, setAiDefaultModelCodex, setAiDefaultModelOllama, setAiDefaultModelOpenai, setAiEffortClaude, setAiEffortCodex, setAiAssistantMode } = useSettings();
const ai = useAi();
const session = useAiSession();
const access = useAiAccessMap();
const health = useAiHealth();
const aiContext = useAiContext();

const aiModels = useAiModels();

const docNeedsSave = computed<boolean>(() => !props.docPath || props.docPath.trim() === '');

function defaultModelFor(cli: CliKind): string {
  if (cli === 'claude') return settings.value.ai.defaultModelClaude;
  if (cli === 'codex') return settings.value.ai.defaultModelCodex;
  if (cli === 'openai') return settings.value.ai.defaultModelOpenai;
  return settings.value.ai.defaultModelOllama;
}

function defaultEffortFor(cli: CliKind): string {
  if (cli === 'claude') return settings.value.ai.effortClaude;
  if (cli === 'codex') return settings.value.ai.effortCodex;
  return '';
}

const selectedCli = ref<CliKind>(settings.value.ai.defaultCli);
const selectedModel = ref<string>(defaultModelFor(selectedCli.value));
const selectedEffort = ref<string>(defaultEffortFor(selectedCli.value));
const customModelInput = ref<string>('');
const inputValue = ref('');
const gearOpen = ref(false);

const LARGE_DOC_THRESHOLD = 200 * 1024;
const sendFullDocOverride = ref(false);

const docMarkdown = computed(() => {
  const c = props.docContent;
  if (!c) return '';
  if (c.trimStart().startsWith('<')) {
    try { return htmlToMarkdown(c); } catch { return c; }
  }
  return c;
});

const docTooLarge = computed(() => docMarkdown.value.length > LARGE_DOC_THRESHOLD);

const liveSelectionText = computed<string | null>(() => {
  if (typeof props.selectionText === 'string') {
    const trimmed = props.selectionText.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const range = props.selectionRange;
  if (!range) return null;
  const md = docMarkdown.value;
  if (!md) return null;
  const start = Math.max(0, Math.min(md.length, range.start));
  const end = Math.max(start, Math.min(md.length, range.end));
  return md.slice(start, end).trim();
});

const pins = useAiPinnedSelections({ liveSelectionText });
const images = useAiPendingImages();
const mentionItems = ref<MentionItem[]>([]);
const attachedFiles = ref<AttachedRef[]>([]);
const projectInstructions = ref('');

function sameAiPath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/') === b.replace(/\\/g, '/');
}

function joinWorkspaceFile(root: string, name: string): string {
  const trimmed = root.replace(/[\\/]+$/, '');
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${trimmed}${sep}${name}`;
}

async function refreshMentionTree() {
  const root = (props.workspaceRoot ?? '').trim();
  if (!root) {
    mentionItems.value = props.docPath
      ? [{ path: props.docPath, name: props.docPath.split(/[\\/]/).pop() ?? props.docPath, kind: 'file' }]
      : [];
    return;
  }
  try {
    const tree = await workspaceFs.readTree(root);
    mentionItems.value = flattenMentions(tree);
  } catch (e) {
    console.warn('[AiPanel] mention tree failed:', e);
    mentionItems.value = [];
  }
}

async function refreshProjectInstructions() {
  if (!settings.value.ai.useProjectInstructions) {
    projectInstructions.value = '';
    return;
  }
  const root = (props.workspaceRoot ?? '').trim();
  if (!root) {
    projectInstructions.value = '';
    return;
  }
  try {
    const { exists, readTextFile } = await import('@tauri-apps/plugin-fs');
    for (const name of ['MERMARK.md', 'AGENTS.md']) {
      const path = joinWorkspaceFile(root, name);
      try {
        if (!(await exists(path))) continue;
        const text = await readTextFile(path);
        projectInstructions.value = clampAiInstructions(text, PROJECT_INSTRUCTIONS_MAX);
        return;
      } catch {
        // Try the next well-known filename.
      }
    }
  } catch (e) {
    console.warn('[AiPanel] project instructions failed:', e);
  }
  projectInstructions.value = '';
}

watch(
  () => [props.workspaceRoot, props.docPath, settings.value.ai.useProjectInstructions] as const,
  async () => {
    await Promise.all([refreshMentionTree(), refreshProjectInstructions()]);
  },
  { immediate: true },
);

async function attachMention(item: MentionItem) {
  if (attachedFiles.value.some((f) => sameAiPath(f.path, item.path))) return;
  const next: AttachedRef = { path: item.path, name: item.name, kind: item.kind };
  if (item.kind === 'file') {
    try {
      const { readTextFile, stat } = await import('@tauri-apps/plugin-fs');
      const info = await stat(item.path);
      if (typeof info.size === 'number' && info.size <= ATTACHED_EXCERPT_MAX) {
        const text = await readTextFile(item.path);
        next.excerpt = text.length > ATTACHED_EXCERPT_MAX
          ? text.slice(0, ATTACHED_EXCERPT_MAX)
          : text;
      }
    } catch {
      // Large or unreadable files stay as a path hint; the model can Read.
    }
  }
  attachedFiles.value = [...attachedFiles.value, next];
}

function removeAttachment(path: string) {
  attachedFiles.value = attachedFiles.value.filter((f) => !sameAiPath(f.path, path));
}

async function onPickMentionFile() {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const sel = await open({
      multiple: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (typeof sel !== 'string' || !sel) return;
    const name = sel.split(/[\\/]/).pop() ?? sel;
    await attachMention({ path: sel, name, kind: 'file' });
  } catch (e) {
    console.warn('[AiPanel] mention file picker failed:', e);
  }
}

function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(0, i) : path;
}

/** Drop missing or oversized raster files so the CLI is not handed huge photos. */
async function keepSendableImagePaths(paths: string[]): Promise<string[]> {
  let statFn: ((p: string) => Promise<{ size: number }>) | null = null;
  try {
    const fs = await import('@tauri-apps/plugin-fs') as { stat?: (p: string) => Promise<{ size: number }> };
    if (typeof fs.stat === 'function') statFn = fs.stat;
  } catch {
    statFn = null;
  }
  if (!statFn) return paths;
  const kept: string[] = [];
  for (const p of paths) {
    try {
      const info = await statFn(p);
      if (isWithinImageBudget(info.size)) kept.push(p);
    } catch {
      // Missing or unreadable files are skipped rather than attached as dead paths.
    }
  }
  return kept;
}

const docImages = computed(() => {
  if (!props.docPath) return [];
  return extractLocalImageRefs(docMarkdown.value, parentDir(props.docPath));
});

const localNoVision = computed(() => {
  const cli = selectedCli.value;
  return (cli === 'ollama' || cli === 'openai') && docImages.value.length > 0;
});

// ===== Mermaid edit mode bridge =====
// When a Mermaid node registers an AI edit target, auto-pin its source so the
// user sees it as scoped context, switch the preamble into mermaid-edit mode,
// and route assistant replies back to the node via target.pushCandidate.
const aiMermaid = useAiMermaidTarget();
const mermaidPinId = ref<string | null>(null);
const mermaidEditMode = computed<boolean>(() => aiMermaid.target.value !== null);

function clearMermaidPin() {
  if (mermaidPinId.value) {
    pins.removePin(mermaidPinId.value);
    mermaidPinId.value = null;
  }
}

watch(
  () => aiMermaid.target.value,
  (target) => {
    clearMermaidPin();
    if (!target) return;
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `mermaid-pin-${Date.now()}`;
    const pin = {
      id,
      text: `[Mermaid diagram]\n${buildMermaidBlockFor(target.initialCode, resolveMermaidWriteFormat(settings.value))}`,
      createdAt: new Date().toISOString(),
    };
    pins.pinnedSelections.value.push(pin);
    pins.includePinned.value = true;
    mermaidPinId.value = id;
  },
);

function stopMermaidEdit() {
  clearMermaidPin();
  aiMermaid.clear();
}
const toolToast = useAiToolToast();
const layout = useAiPanelLayout({
  panelSide: () => settings.value.ai.panelSide,
  onClose: () => emit('close'),
  onPreviewDismiss: () => {
    if (images.previewedImage.value) {
      images.previewedImage.value = null;
      return true;
    }
    return false;
  },
});

/** Non-null only while the panel is docked, i.e. actually occupying a column. */
const reservedSide = computed<'left' | 'right' | null>(() => {
  if (!props.open || !settings.value.ai.enabled) return null;
  return layout.reservedSide.value;
});

const panelRef = ref<HTMLElement | null>(null);

// The divider drags against the flex row the pane shares with the editor, so
// the usable range tracks the window rather than a hard-coded maximum.
function onDividerResize(clientX: number) {
  const row = panelRef.value?.parentElement;
  if (!row) return;
  layout.resizeFromPointer(clientX, row.getBoundingClientRect());
}

// Always list every provider. Health lives on the status dot; hiding a CLI
// just because the binary check failed also hid the settings needed to fix it.
const availableClis: CliKind[] = ['claude', 'codex', 'ollama', 'openai'];

const modelOptions = computed(() => modelsFor(selectedCli.value));
const effortOptions = computed(() => effortsFor(selectedCli.value));
const cliConnected = computed(() => health.cache.value[selectedCli.value]?.ok ?? false);
const anyHealthLoading = computed(() => health.loading.value.claude || health.loading.value.codex || health.loading.value.ollama || health.loading.value.openai);

const isCustomModel = computed(() => {
  const opts = modelOptions.value;
  return !opts.some(o => o.id === selectedModel.value && !o.custom);
});

// Local providers have no server-side default model — an empty id would just
// 400. Disable send and surface a hint instead.
const modelMissing = computed(() =>
  (selectedCli.value === 'ollama' || selectedCli.value === 'openai') && !selectedModel.value.trim(),
);

watch(isCustomModel, (custom) => {
  if (custom && !customModelInput.value) {
    customModelInput.value = selectedModel.value;
  }
}, { immediate: true });

// True while we're applying a thread's stored CLI/model/effort during a
// thread switch — suppresses the "CLI changed → new thread" side effect so
// the just-restored thread isn't immediately wiped out.
const restoringThread = ref(false);

watch(selectedCli, (cli, oldCli) => {
  setAiDefaultCli(cli);
  if (!restoringThread.value) {
    selectedModel.value = defaultModelFor(cli);
    selectedEffort.value = defaultEffortFor(cli);
  }
  if (cli === 'ollama') {
    void aiModels.refreshOllamaModels(settings.value.ai.ollamaBaseUrl || null);
  } else if (cli === 'openai') {
    void aiModels.refreshOpenaiModels(settings.value.ai.openaiBaseUrl || null);
  } else if (cli === 'codex') {
    void aiModels.refreshCodexModels();
  }
  aiContext.reset(cli);
  if (oldCli && oldCli !== cli && !restoringThread.value) {
    ai.startNewThread();
    session.startNew();
  }
});

watch(selectedModel, (m) => {
  if (selectedCli.value === 'claude') setAiDefaultModelClaude(m);
  else if (selectedCli.value === 'codex') setAiDefaultModelCodex(m);
  else if (selectedCli.value === 'openai') setAiDefaultModelOpenai(m);
  else setAiDefaultModelOllama(m);
});

watch(selectedEffort, (e) => {
  if (selectedCli.value === 'claude') setAiEffortClaude(e);
  else if (selectedCli.value === 'codex') setAiEffortCodex(e);
});

onMounted(async () => {
  layout.mount();
  ai.bindDoc(props.docPath || '');
  if (selectedCli.value === 'ollama') {
    void aiModels.refreshOllamaModels(settings.value.ai.ollamaBaseUrl || null);
  } else if (selectedCli.value === 'openai') {
    void aiModels.refreshOpenaiModels(settings.value.ai.openaiBaseUrl || null);
  } else if (selectedCli.value === 'codex') {
    void aiModels.refreshCodexModels();
  }
  if (props.docPath) {
    await Promise.all([
      session.loadFor(props.docPath),
      access.loadFor(props.docPath),
      health.checkAll().catch(() => {}),
    ]);
  } else {
    health.checkAll().catch(() => {});
  }
});

onUnmounted(() => {
  layout.unmount();
  // Drop our auto-pin so it doesn't reappear if the panel is mounted later
  // without a matching mermaid target.
  clearMermaidPin();
  // Closing the panel ends any in-flight mermaid edit session — otherwise the
  // diagram fullscreen would keep the AI-panel-side gap reserved with nothing
  // there to fill it.
  if (aiMermaid.target.value) {
    aiMermaid.clear();
  }
});

watch(() => props.docPath, async (p) => {
  ai.bindDoc(p || '');
  if (p) {
    await session.loadFor(p);
    await access.loadFor(p);
  }
});

function effectiveAccessMap() {
  return accessMapForSend(
    access.current.value,
    props.workspaceRoot ?? '',
    settings.value.ai.assistantMode,
    settings.value.ai.workspaceWrite,
  );
}

function preambleOptions(sessionIdToSend: string | null = null): PreambleOptions {
  const localeKey = (typeof navigator !== 'undefined' && (localStorage.getItem('mermark-locale') ?? 'en')) || 'en';
  const isLocal = selectedCli.value === 'ollama' || selectedCli.value === 'openai';
  // The CLI agents lose the compacted turns with their session, so the summary
  // rides along on the first turn of the replacement session. Local providers
  // replay it as history instead and must not receive it twice.
  const compactionSummary = !isLocal && !sessionIdToSend
    ? ai.lastCompactionSummary.value ?? undefined
    : undefined;
  return {
    compactionSummary,
    pins: pins.includePinned.value
      ? pins.pinnedSelections.value.map(p => ({ id: p.id, text: p.text }))
      : [],
    includePins: pins.includePinned.value,
    selectionRange: props.selectionRange,
    accessMap: effectiveAccessMap(),
    docPath: props.docPath,
    docNeedsSave: docNeedsSave.value,
    docTooLarge: docTooLarge.value,
    sendFullDocOverride: sendFullDocOverride.value,
    docMarkdownLength: docMarkdown.value.length,
    localeKey,
    workspaceName: props.workspaceName ?? '',
    workspaceRoot: props.workspaceRoot ?? '',
    mermaidEditMode: mermaidEditMode.value,
    mermaidWriteFormat: resolveMermaidWriteFormat(settings.value),
    localTools: selectedCli.value === 'ollama' || selectedCli.value === 'openai',
    docImages: capDocImages(docImages.value, MAX_DOC_IMAGES_PER_TURN).map(r => ({
      alt: r.alt,
      absolutePath: r.absolutePath,
    })),
    assistantMode: settings.value.ai.assistantMode,
    customInstructions: settings.value.ai.customInstructions,
    projectInstructions: projectInstructions.value,
    workspaceWrite: settings.value.ai.workspaceWrite && settings.value.ai.assistantMode === 'agent',
    attachedFiles: attachedFiles.value,
  };
}

async function onSend() {
  if (!inputValue.value.trim() || !access.current.value || modelMissing.value) return;

  if (pins.pinnedSelections.value.length === 0 && liveSelectionText.value) {
    pins.pinCurrentSelection();
  }

  const sentPins = (pins.includePinned.value && pins.pinnedSelections.value.length > 0)
    ? pins.pinnedSelections.value.map(p => ({ id: p.id, text: p.text }))
    : [];

  const prompt = inputValue.value;
  inputValue.value = '';

  let imagePaths: string[] = [];
  try {
    imagePaths = await images.persistPendingImagesForSend();
  } catch (e) {
    console.error('[AiPanel] persisting images failed:', e);
    window.alert(`Image upload failed: ${(e as Error)?.message ?? e}`);
    return;
  }
  // Detach images from the composer strip and hand the blob URLs to the chat
  // history so user sees thumbnails of what was sent. Don't revoke — chat now
  // owns these URLs.
  const sentImages = images.detachForChat();

  if ((selectedCli.value === 'claude' || selectedCli.value === 'codex') && docImages.value.length > 0) {
    const extra = capDocImages(docImages.value, MAX_DOC_IMAGES_PER_TURN)
      .map(r => r.absolutePath)
      .filter(p => !imagePaths.includes(p));
    imagePaths = [...imagePaths, ...(await keepSendableImagePaths(extra))];
  }

  if (sentPins.length > 0 || sentImages.length > 0) {
    ai.pushAttachment({ pins: sentPins, images: sentImages });
  }

  const sessionIdToSend = (session.current.value && session.current.value.cli === selectedCli.value)
    ? session.current.value.sessionId
    : null;

  if (!docNeedsSave.value) {
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const onDiskBefore = await readTextFile(props.docPath);
      await aiCommands.snapshotCreate(
        props.docPath,
        onDiskBefore,
        sessionIdToSend,
        settings.value.ai.snapshotsKeep,
      );
    } catch (e) {
      console.warn('[AiPanel] pre-send snapshot failed (continuing anyway):', e);
    }
  }

  const opts = preambleOptions(sessionIdToSend);
  const docAttachment = buildDocAttachment(selectedCli.value, docMarkdown.value, settings.value.ai.ollamaNumCtx);
  const turnContext = [buildTurnContext(opts), docAttachment.omittedNote ?? '']
    .filter(Boolean)
    .join('\n\n');
  const staticPreamble = buildStaticPreamble(opts);
  const staticHash = hashPreamble(staticPreamble);
  const sendStatic = shouldSendStaticPreamble({
    sessionId: sessionIdToSend,
    cli: selectedCli.value,
    hasImages: imagePaths.length > 0,
    staticHash,
    lastSentStaticHash: ai.activeThread.value?.lastSentStaticHash ?? null,
  });

  await ai.send({
    cli: selectedCli.value,
    sessionId: sessionIdToSend,
    model: selectedModel.value,
    effort: selectedEffort.value,
    prompt,
    preamble: sendStatic ? staticPreamble : '',
    turnContext,
    staticPreambleHash: staticHash,
    accessMap: effectiveAccessMap()!,
    workDir: props.workDir,
    images: imagePaths,
    docContent: docAttachment.content,
    onSessionId: async (sid) => {
      await session.persistFromResponse({
        docPath: props.docPath,
        cli: selectedCli.value,
        sessionId: sid,
        docContent: docMarkdown.value,
      });
    },
    onToolRequest: async (tool, args) => {
      toolToast.trigger(tool);
      // Local providers snapshot inside write_file/edit_file. CLI agents write
      // themselves, so we snapshot a sibling note as soon as the tool is named.
      const local = selectedCli.value === 'ollama' || selectedCli.value === 'openai';
      if (local || classifyAiTool(tool) !== 'edit') return;
      const path = extractToolFilePath(args);
      if (!path || sameAiPath(path, props.docPath)) return;
      try {
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        const before = await readTextFile(path);
        await aiCommands.snapshotCreate(
          path,
          before,
          sessionIdToSend,
          settings.value.ai.snapshotsKeep,
        );
      } catch (e) {
        console.warn('[AiPanel] sibling snapshot failed:', e);
      }
    },
  });

  // Mermaid bridge: hand the freshly-completed assistant reply to the singleton.
  // Apply / Discard live in the panel chip and read from the same store.
  if (aiMermaid.target.value) {
    const lastMsg = ai.messages.value[ai.messages.value.length - 1];
    if (lastMsg?.role === 'assistant' && lastMsg.text) {
      const code = extractMermaidCodeFromResponse(lastMsg.text, resolveMermaidReadFormats(settings.value));
      if (code) aiMermaid.pushCandidate(code);
    }
  }

  await maybeCompact();
}

const showCarryOutPlan = computed(() => {
  if (settings.value.ai.assistantMode !== 'plan') return false;
  if (ai.isActiveThreadSending.value) return false;
  const msgs = ai.messages.value;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === 'assistant' && m.done && m.text.trim()) return true;
    if (m.role === 'user') break;
  }
  return false;
});

async function onCarryOutPlan() {
  setAiAssistantMode('agent');
  inputValue.value = t.value.aiCarryOutPlanPrompt;
  await onSend();
}

/**
 * Fold the conversation into a summary once the window is nearly full, so the
 * next turn has room instead of the user being told to start over. Runs after
 * the reply has landed: the user reads their answer while we tidy up, and a
 * failure here costs nothing but the space we hoped to free.
 */
async function maybeCompact() {
  if (!shouldCompact({
    fraction: ai.aiContext.usage.value.fraction,
    empty: ai.aiContext.usage.value.empty,
    messages: ai.messages.value,
  })) return;

  ai.isCompacting.value = true;
  try {
    const summary = await ai.sendSilent({
      cli: selectedCli.value,
      // Summarising inside the live session lets the CLI agents read the turns
      // they still hold; applyCompaction retires the session straight after.
      sessionId: (session.current.value && session.current.value.cli === selectedCli.value)
        ? session.current.value.sessionId
        : null,
      model: selectedModel.value,
      effort: selectedEffort.value,
      prompt: buildSummaryPrompt(),
      accessMap: effectiveAccessMap()!,
      workDir: props.workDir,
    });
    if (!summary) return;
    ai.applyCompaction(summary);
    session.startNew();
    // The meter reads the last turn, which was the pre-compaction one. Leaving
    // it would keep the "nearly full" warning up over context we just freed;
    // the next turn reports the real figure for the shortened conversation.
    ai.aiContext.reset(selectedCli.value);
  } catch (e) {
    // Leave the thread untouched — the next send still works, just without the
    // headroom, and the context bar keeps warning.
    console.warn('[AiPanel] compaction failed, keeping full history:', e);
  } finally {
    ai.isCompacting.value = false;
  }
}

async function onCancel() { await ai.cancel(); }

const changeDiffs = ref<Record<number, ChangeDiff>>({});

async function snapshotVsCurrent(path: string): Promise<{ orig: string; current: string } | null> {
  const items = await aiCommands.snapshotList(path);
  if (items.length === 0) return null;
  const latest = [...items].sort((a, b) => b.ts.localeCompare(a.ts))[0];
  const orig = await aiCommands.snapshotRestore(path, latest.id);
  let current = docMarkdown.value;
  if (!sameAiPath(path, props.docPath)) {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    current = await readTextFile(path);
  }
  return { orig, current };
}

async function fillChangeDiffs(tryDisk: boolean) {
  const msgs = ai.messages.value;
  const next: Record<number, ChangeDiff> = { ...changeDiffs.value };
  let changed = false;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role !== 'tool' || classifyAiTool(m.tool) !== 'edit') continue;
    const fromArgs = diffFromToolArgs(m.text);
    if (fromArgs && !next[i]) {
      next[i] = fromArgs;
      changed = true;
    }
    if (!tryDisk) continue;
    const path = extractToolFilePath(m.text) ?? props.docPath;
    if (!path) continue;
    try {
      const pair = await snapshotVsCurrent(path);
      const fromFile = pair ? generateDiff(pair.orig, pair.current) : null;
      const chosen = preferFileDiff(fromFile, fromArgs ?? next[i] ?? null);
      if (chosen && chosen !== next[i]) {
        next[i] = chosen;
        changed = true;
      }
    } catch (e) {
      console.warn('[AiPanel] inline change diff failed:', e);
    }
  }
  if (changed) changeDiffs.value = next;
}

watch(
  () => [ai.messages.value.length, ai.isActiveThreadSending.value, ai.activeThread.value?.id ?? ''] as const,
  async ([, sending, threadId], prev) => {
    if (prev && prev[2] !== threadId) changeDiffs.value = {};
    await fillChangeDiffs(sending === false);
  },
  { immediate: true },
);

function onKeepChange(index: number) {
  ai.setChangeStatus(index, 'kept');
}

async function onUndoChange(index: number) {
  const msg = ai.messages.value[index];
  const path = extractToolFilePath(msg?.text ?? '') ?? props.docPath;
  await revertLastSnapshot(path);
  ai.setChangeStatus(index, 'undone');
}

async function onShowChangeDiff(index: number) {
  const msg = ai.messages.value[index];
  const path = extractToolFilePath(msg?.text ?? '') ?? props.docPath;
  if (!path) return;
  try {
    const pair = await snapshotVsCurrent(path);
    if (!pair) return;
    emit('showDiff', pair.orig, pair.current);
  } catch (e) {
    console.error('[AiPanel] show change diff failed:', e);
  }
}

async function revertLastSnapshot(path: string = props.docPath) {
  try {
    const items = await aiCommands.snapshotList(path);
    if (items.length === 0) {
      window.alert('No snapshots to revert to.');
      return;
    }
    const sorted = [...items].sort((a, b) => b.ts.localeCompare(a.ts));
    const latest = sorted[0];
    const ok = window.confirm(`Revert to snapshot from ${latest.ts}?`);
    if (!ok) return;
    const content = await aiCommands.snapshotRestore(path, latest.id);
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content);
    if (sameAiPath(path, props.docPath)) {
      emit('applyContent', content);
    }
  } catch (e) {
    console.error('[AiPanel] revert failed:', e);
    window.alert(`Revert failed: ${(e as Error).message}`);
  }
}

async function onSnapshotRestored(content: string) {
  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(props.docPath, content);
    emit('applyContent', content);
  } catch (e) {
    console.error('[AiPanel] snapshot restore write failed:', e);
    window.alert(`Restore failed: ${(e as Error).message}`);
  }
}

function newChat() {
  ai.startNewThread();
  session.startNew();
  aiContext.reset(selectedCli.value);
  attachedFiles.value = [];
}

async function onSelectThread(id: string) {
  ai.selectThread(id);
  // Restore CLI / model / effort from the thread so the user picks up where
  // they left off. Fall back to current selection when fields are missing
  // (legacy thread that pre-dates per-thread model persistence).
  const thread = ai.threads.value.find(x => x.id === id);
  restoringThread.value = true;
  if (thread?.cli && thread.cli !== selectedCli.value) {
    selectedCli.value = thread.cli;
  }
  if (thread?.model) {
    selectedModel.value = thread.model;
  }
  if (thread?.effort) {
    selectedEffort.value = thread.effort;
  }
  // Wait for the CLI/model/effort watchers to flush before lifting the guard,
  // otherwise the CLI watcher would see restoringThread === false and clobber
  // model/effort with the per-CLI defaults.
  await nextTick();
  restoringThread.value = false;
  aiContext.reset(selectedCli.value);
}

function onDeleteThread(id: string) {
  ai.deleteThread(id);
}

function onPickImage() {
  void images.pickImageFile();
}

function onPreviewImage(img: PendingImage) {
  images.previewedImage.value = img;
}
</script>

<template>
  <AiPanelTab
    v-if="props.open && settings.ai.enabled && layout.minimized.value"
    :side="settings.ai.panelSide"
    :class="{ 'ai-panel-tab--above-fullscreen': mermaidEditMode }"
    :style="layout.minimizedStyle.value"
    @restore="layout.minimized.value = false"
  />

  <ResizeDivider
    v-if="reservedSide !== null"
    class="ai-panel-divider"
    :class="{ 'ai-panel-divider--left': reservedSide === 'left' }"
    :aria-label="t.aiPanelTitle"
    @resize="onDividerResize"
  />

  <aside
    ref="panelRef"
    v-if="props.open && settings.ai.enabled && !layout.minimized.value"
    class="ai-panel"
    :class="{
      'ai-panel--fullscreen': layout.fullscreen.value,
      'ai-panel--docked': reservedSide !== null,
      'ai-panel--left': settings.ai.panelSide === 'left' && !layout.fullscreen.value,
      'ai-panel--above-fullscreen': mermaidEditMode,
    }"
    :style="layout.dockedStyle.value"
  >
    <AiPanelHeader
      :threads="ai.threads.value"
      :active-thread-id="ai.activeThreadId.value"
      :fullscreen="layout.fullscreen.value"
      :title-text="t.aiPanelTitle"
      :fullscreen-title="t.aiFullscreen"
      :exit-fullscreen-title="t.aiExitFullscreen"
      :close-title="t.aiClose"
      :new-chat-title="t.aiNewChat"
      @minimize="layout.minimized.value = true"
      @toggle-fullscreen="layout.fullscreen.value = !layout.fullscreen.value"
      @close="emit('close')"
      @revert="revertLastSnapshot"
      @new-chat="newChat"
      @select-thread="onSelectThread"
      @delete-thread="onDeleteThread"
      @threads-ref="(el) => layout.setThreadsDetails(el)"
    />

    <AiPanelContextBar :usage="aiContext.usage.value" :usage-label="aiContext.usageLabel.value" />

    <div v-if="mermaidEditMode" class="ai-panel-mermaid-chip">
      <span class="ai-panel-mermaid-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="6" width="16" height="14" rx="3"/>
          <circle cx="9" cy="13" r="1.3" fill="currentColor"/>
          <circle cx="15" cy="13" r="1.3" fill="currentColor"/>
          <line x1="9" y1="17" x2="15" y2="17"/>
          <line x1="12" y1="3" x2="12" y2="6"/>
          <circle cx="12" cy="2.5" r="1" fill="currentColor"/>
          <line x1="2" y1="11" x2="4" y2="11"/>
          <line x1="2" y1="14" x2="4" y2="14"/>
          <line x1="20" y1="11" x2="22" y2="11"/>
          <line x1="20" y1="14" x2="22" y2="14"/>
        </svg>
      </span>
      <span class="ai-panel-mermaid-label">Editing mermaid diagram</span>
      <button
        v-if="aiMermaid.candidate.value !== null"
        class="ai-panel-mermaid-apply"
        @click="aiMermaid.applyCandidate()"
        :title="t.aiAssistMermaidApply"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        {{ t.aiAssistMermaidApply }}
      </button>
      <button
        v-if="aiMermaid.candidate.value !== null"
        class="ai-panel-mermaid-discard"
        @click="aiMermaid.discardCandidate()"
        :title="t.cancel"
      >×</button>
      <button class="ai-panel-mermaid-stop" @click="stopMermaidEdit">Stop</button>
    </div>

    <AiPanelStatusNotices :connecting="anyHealthLoading" :unsaved="docNeedsSave" />

    <AiPanelMessages
      :messages="ai.messages.value"
      :is-sending="ai.isActiveThreadSending.value"
      :is-compacting="ai.isCompacting.value"
      :empty-hint="t.aiEmptyHint"
      :cli-connected="cliConnected"
      :auth-required-hint="t.aiStatusAuthRequired"
      :connecting="anyHealthLoading"
      :send-started-at="ai.sendStartedAt.value"
      :last-tool-name="ai.lastToolName.value"
      :is-stalled="ai.isStalled.value"
      :active-doc-path="props.docPath"
      :show-carry-out-plan="showCarryOutPlan"
      :change-diffs="changeDiffs"
      @link-click="(url) => emit('linkClick', url)"
      @show-attachment="(p) => pins.openAttachment(p)"
      @keep-change="onKeepChange"
      @undo-change="onUndoChange"
      @show-change-diff="onShowChangeDiff"
      @cancel="onCancel"
      @report-feedback="emit('reportFeedback')"
      @carry-out-plan="onCarryOutPlan"
    />

    <AiPanelComposer
      :input-value="inputValue"
      :cli-connected="cliConnected"
      :model-missing="modelMissing"
      :is-sending="ai.isActiveThreadSending.value"
      :is-stalled="ai.isStalled.value"
      :sending-other-thread="ai.isSending.value && !ai.isActiveThreadSending.value"
      :auth-required-hint="t.aiStatusAuthRequired"
      :send-button-text="t.aiSendButton"
      :cancel-button-text="t.aiCancelButton"
      :doc-too-large="docTooLarge"
      :doc-markdown-length-kb="Math.round(docMarkdown.length / 1024)"
      :send-full-doc-override="sendFullDocOverride"
      :pinned-selections="pins.pinnedSelections.value"
      :include-pinned="pins.includePinned.value"
      :show-live-selection="pins.showLiveSelection.value"
      :live-selection-text="liveSelectionText"
      :pin-preview="pins.previewOf"
      :pending-images="images.pendingImages.value"
      :local-no-vision="localNoVision"
      :mention-items="mentionItems"
      :attached-files="attachedFiles"
      @update:input-value="(v) => inputValue = v"
      @update:send-full-doc-override="(v) => sendFullDocOverride = v"
      @update:include-pinned="(v) => pins.includePinned.value = v"
      @send="onSend"
      @cancel="onCancel"
      @paste="(e) => images.onComposerPaste(e)"
      @pick-image="onPickImage"
      @pin="pins.pinCurrentSelection"
      @remove-pin="(id) => pins.removePin(id)"
      @clear-pins="pins.clearAllPins"
      @preview-image="onPreviewImage"
      @remove-image="(id) => images.removePendingImage(id)"
      @clear-images="images.clearPendingImages"
      @open-settings="gearOpen = true"
      @attach-mention="attachMention"
      @remove-attachment="removeAttachment"
      @pick-mention-file="onPickMentionFile"
    >
      <template #model>
        <AiPanelModelPicker
          :cli="selectedCli"
          :available-clis="availableClis"
          :model="selectedModel"
          :model-options="modelOptions"
          :effort="selectedEffort"
          :effort-options="effortOptions"
          :custom-model-input="customModelInput"
          :is-custom-model="isCustomModel"
          :cli-connected="cliConnected"
          :cli-account="health.cache.value[selectedCli]?.account ?? ''"
          :status-ok-label="t.aiStatusOk"
          :status-auth-label="t.aiStatusAuthRequired"
          :model-title="t.aiModel"
          :default-cli-title="t.aiDefaultCli"
          @update:cli="(v) => selectedCli = v"
          @update:model="(v) => selectedModel = v"
          @update:effort="(v) => selectedEffort = v"
          @update:custom-model-input="(v) => customModelInput = v"
        />
      </template>
      <template #mode>
        <AiPanelModeChips
          :mode="settings.ai.assistantMode"
          @update:mode="setAiAssistantMode"
        />
      </template>
    </AiPanelComposer>

    <AiPanelGearSheet
      :open="gearOpen"
      :access-map-title="t.aiAccessMapTitle"
      :doc-path="props.docPath"
      :access-map="access.current.value"
      :workspace-root="props.workspaceRoot"
      @close="gearOpen = false"
      @update:access-map="(v) => access.save(v)"
      @snapshot-restored="onSnapshotRestored"
      @report-feedback="emit('reportFeedback')"
    />

    <AiToolToast :tool="toolToast.toolActivity.value" />

    <AiAttachmentModal
      v-if="pins.attachmentModal.value"
      :pins="pins.attachmentModal.value"
      @close="pins.closeAttachment"
    />

    <AiImagePreview
      v-if="images.previewedImage.value"
      :src="images.previewedImage.value.blobUrl"
      :name="images.previewedImage.value.name"
      @close="images.previewedImage.value = null"
    />
  </aside>
</template>

<style scoped>
.ai-panel {
  background: var(--bg-primary);
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  position: relative;
}
/* Docked: an ordinary flex sibling of the editor area, sized by dockedStyle.
   `order` puts it on the configured side without re-mounting the component,
   which would otherwise drop the in-flight chat when the side is switched. */
.ai-panel--docked {
  order: 2;
  overflow: hidden;
}
.ai-panel--docked.ai-panel--left {
  order: -2;
}
.ai-panel-divider {
  order: 1;
}
.ai-panel-divider--left {
  order: -1;
}
.ai-panel--fullscreen {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  border: none;
  border-radius: 0;
  z-index: 100;
}
/* When bound to a mermaid edit target, the diagram fullscreen overlay
   (z-index 99999) would otherwise sit on top of the panel and tab. Bump
   ours so they stay reachable without shrinking the diagram. */
.ai-panel--above-fullscreen,
.ai-panel-tab--above-fullscreen {
  z-index: 100000;
}
/* A docked pane sits in normal flow, where z-index alone does nothing. Give it
   a stacking context so the bump above actually takes effect. */
.ai-panel--docked.ai-panel--above-fullscreen {
  position: relative;
}
.ai-panel-mermaid-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin: 6px 8px 0;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-left: 3px solid var(--primary, #6366f1);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-primary);
}
.ai-panel-mermaid-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--primary, #6366f1);
  color: #fff;
  flex-shrink: 0;
}
.ai-panel-mermaid-label {
  flex: 1;
  font-weight: 500;
}
.ai-panel-mermaid-apply,
.ai-panel-mermaid-discard,
.ai-panel-mermaid-stop {
  border: 1px solid var(--border-primary);
  background: var(--bg-primary);
  color: var(--text-primary);
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.ai-panel-mermaid-apply {
  background: var(--primary, #6366f1);
  color: #fff;
  border-color: var(--primary, #6366f1);
  font-weight: 600;
}
.ai-panel-mermaid-apply:hover {
  filter: brightness(1.05);
}
.ai-panel-mermaid-discard {
  width: 24px;
  padding: 0;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
}
.ai-panel-mermaid-stop:hover,
.ai-panel-mermaid-discard:hover {
  background: var(--bg-secondary);
}
</style>
