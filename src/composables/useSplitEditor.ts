import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';
import { htmlToMarkdown, markdownToHtml } from '../utils/markdown-converter';
import { clamp } from '../utils/resize';

const PREVIEW_DEBOUNCE_MS = 200;

const RATIO_STORAGE_KEY = 'mermark-split-editor-ratio';
const DEFAULT_RATIO = 0.5;
export const MIN_SPLIT_EDITOR_RATIO = 0.2;
export const MAX_SPLIT_EDITOR_RATIO = 0.8;

const splitEditorActive = ref<boolean>(false);

function loadRatio(): number {
  try {
    const saved = localStorage.getItem(RATIO_STORAGE_KEY);
    if (saved !== null) {
      const parsed = Number.parseFloat(saved);
      if (Number.isFinite(parsed)) {
        return clamp(parsed, MIN_SPLIT_EDITOR_RATIO, MAX_SPLIT_EDITOR_RATIO);
      }
    }
  } catch (error) {
    console.error('Error loading split editor ratio:', error);
  }
  return DEFAULT_RATIO;
}

// Module-level so the width survives leaving and re-entering Code + Preview.
const splitEditorRatio = ref<number>(loadRatio());

watch(splitEditorRatio, (ratio) => {
  try {
    localStorage.setItem(RATIO_STORAGE_KEY, String(ratio));
  } catch (error) {
    console.error('Error saving split editor ratio:', error);
  }
});

export interface UseSplitEditorReturn {
  splitEditorActive: Ref<boolean>;
  markdownSource: Ref<string>;
  previewHtml: ComputedRef<string>;
  /** Fraction of the pane row taken by the code side (0.2-0.8). */
  splitEditorRatio: Ref<number>;
  setSplitEditorRatio: (ratio: number) => void;
  enter: (html: string) => void;
  exit: () => string;
  onMarkdownInput: (value: string) => void;
  syncFromVisual: (html: string) => void;
}

export function useSplitEditor(): UseSplitEditorReturn {
  const markdownSource = ref('');
  const debouncedSource = ref('');
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const previewHtml = computed(() => markdownToHtml(debouncedSource.value));

  const enter = (html: string): void => {
    const md = htmlToMarkdown(html);
    markdownSource.value = md;
    debouncedSource.value = md;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const exit = (): string => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    debouncedSource.value = markdownSource.value;
    return markdownToHtml(markdownSource.value);
  };

  const onMarkdownInput = (value: string): void => {
    markdownSource.value = value;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debouncedSource.value = markdownSource.value;
      debounceTimer = null;
    }, PREVIEW_DEBOUNCE_MS);
  };

  // Visual → code, for in-preview node edits only (e.g. editing a Mermaid
  // diagram via AI/manual). Caller gates this on the preview editor's real-edit
  // signal, so the code→visual push echo never reaches here. debouncedSource /
  // previewHtml are left untouched so the preview isn't re-rendered mid-edit.
  const syncFromVisual = (html: string): void => {
    const md = htmlToMarkdown(html);
    if (md === markdownSource.value) return;
    markdownSource.value = md;
  };

  const setSplitEditorRatio = (ratio: number): void => {
    splitEditorRatio.value = clamp(ratio, MIN_SPLIT_EDITOR_RATIO, MAX_SPLIT_EDITOR_RATIO);
  };

  return {
    splitEditorActive,
    markdownSource,
    previewHtml,
    splitEditorRatio,
    setSplitEditorRatio,
    enter,
    exit,
    onMarkdownInput,
    syncFromVisual,
  };
}
