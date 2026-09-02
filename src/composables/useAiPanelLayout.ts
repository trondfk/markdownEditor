import { computed, ref, watch } from 'vue';
import { clamp, widthFromPointer, type Bounds } from '../utils/resize';

export interface AiPanelLayoutOptions {
  panelSide: () => 'left' | 'right';
  isFullscreenInputTarget?: (target: EventTarget | null) => boolean;
  onClose: () => void;
  onPreviewDismiss?: () => boolean;
}

const DEFAULT_TOP_OFFSET = 44;
const WIDTH_STORAGE_KEY = 'mermark-ai-panel-width';
const DEFAULT_WIDTH = 420;
export const MIN_AI_PANEL_WIDTH = 280;
export const MAX_AI_PANEL_WIDTH = 900;
/** Editor room the pane must never swallow, so the document stays usable. */
export const MIN_EDITOR_WIDTH = 320;

function loadWidth(): number {
  try {
    const saved = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (saved !== null) {
      const parsed = Number.parseFloat(saved);
      if (Number.isFinite(parsed)) {
        return clamp(parsed, MIN_AI_PANEL_WIDTH, MAX_AI_PANEL_WIDTH);
      }
    }
  } catch (error) {
    console.error('Error loading AI panel width:', error);
  }
  return DEFAULT_WIDTH;
}

export function useAiPanelLayout(opts: AiPanelLayoutOptions) {
  const fullscreen = ref(false);
  const minimized = ref(false);
  const topOffset = ref(DEFAULT_TOP_OFFSET);
  const width = ref(loadWidth());

  watch(width, (value) => {
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(value)));
    } catch (error) {
      console.error('Error saving AI panel width:', error);
    }
  });

  let toolbarObserver: ResizeObserver | null = null;
  let threadsDetailsRef: HTMLDetailsElement | null = null;

  function measureToolbar() {
    const tb = document.querySelector('.toolbar');
    if (tb) {
      const rect = tb.getBoundingClientRect();
      topOffset.value = Math.ceil(rect.bottom);
    }
  }

  function setThreadsDetails(el: HTMLDetailsElement | null) {
    threadsDetailsRef = el;
  }

  function onWindowClick(e: MouseEvent) {
    const det = threadsDetailsRef;
    if (det && det.open && !det.contains(e.target as Node)) {
      det.removeAttribute('open');
    }
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && opts.onPreviewDismiss && opts.onPreviewDismiss()) {
      return;
    }
    if (e.key === 'Escape' && !fullscreen.value) {
      const target = e.target as HTMLElement | null;
      const isInput = target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT';
      if (!isInput) opts.onClose();
    }
    if (e.key === 'Escape' && fullscreen.value) {
      fullscreen.value = false;
    }
  }

  const reservedSide = computed<'left' | 'right' | null>(() => {
    if (fullscreen.value || minimized.value) return null;
    return opts.panelSide();
  });

  /**
   * Flex sizing for the docked pane. Empty while fullscreen or minimized, where
   * the panel leaves the layout flow entirely.
   */
  const dockedStyle = computed<Record<string, string>>(() => {
    const undocked: Record<string, string> = {};
    if (reservedSide.value === null) return undocked;
    return { flex: `0 0 ${width.value}px` };
  });

  /**
   * Apply a divider drag. `bounds` is the flex row the pane shares with the
   * editor, so the ceiling adapts to the window instead of a fixed maximum.
   */
  function resizeFromPointer(clientX: number, bounds: Bounds): void {
    const ceiling = bounds.width > 0
      ? Math.min(MAX_AI_PANEL_WIDTH, bounds.width - MIN_EDITOR_WIDTH)
      : MAX_AI_PANEL_WIDTH;
    width.value = widthFromPointer(
      clientX,
      bounds,
      opts.panelSide(),
      MIN_AI_PANEL_WIDTH,
      ceiling,
    );
  }

  const minimizedStyle = computed<Record<string, string>>(() => {
    return opts.panelSide() === 'left'
      ? { left: '0', right: 'auto', top: `${topOffset.value + 12}px` }
      : { right: '0', left: 'auto', top: `${topOffset.value + 12}px` };
  });

  function mount() {
    window.addEventListener('keydown', onGlobalKeydown);
    window.addEventListener('click', onWindowClick);
    measureToolbar();
    const tb = document.querySelector('.toolbar');
    if (tb && 'ResizeObserver' in window) {
      toolbarObserver = new ResizeObserver(measureToolbar);
      toolbarObserver.observe(tb);
    }
    window.addEventListener('resize', measureToolbar);
  }

  function unmount() {
    window.removeEventListener('keydown', onGlobalKeydown);
    window.removeEventListener('click', onWindowClick);
    window.removeEventListener('resize', measureToolbar);
    toolbarObserver?.disconnect();
    toolbarObserver = null;
  }

  return {
    fullscreen,
    minimized,
    topOffset,
    width,
    reservedSide,
    dockedStyle,
    resizeFromPointer,
    minimizedStyle,
    mount,
    unmount,
    setThreadsDetails,
    measureToolbar,
  };
}
