// ABOUTME: Default shortcut table for app actions and toolbar writing tools.
// ABOUTME: Ids align with TOOLBAR_ITEMS so Settings can bind the same tools.

export interface KeyChord {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export type KeybindActionGroup = 'app' | 'writing';

export interface KeybindActionDef {
  id: string;
  labelKey: string;
  group: KeybindActionGroup;
  /** When true, App.vue still owns the handler (file, view). Writing tools go through useToolbarActions. */
  defaultBinding: KeyChord | null;
}

export function chord(key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): KeyChord {
  return { key, ctrl: !!mods.ctrl, shift: !!mods.shift, alt: !!mods.alt };
}

export const KEYBIND_ACTIONS: KeybindActionDef[] = [
  { id: 'new-file', labelKey: 'new', group: 'app', defaultBinding: chord('n', { ctrl: true }) },
  { id: 'open-file', labelKey: 'open', group: 'app', defaultBinding: chord('o', { ctrl: true }) },
  { id: 'save-file', labelKey: 'save', group: 'app', defaultBinding: chord('s', { ctrl: true }) },
  { id: 'save-file-as', labelKey: 'saveAs', group: 'app', defaultBinding: chord('s', { ctrl: true, shift: true }) },
  { id: 'export-pdf', labelKey: 'exportPdf', group: 'app', defaultBinding: chord('p', { ctrl: true }) },
  { id: 'show-settings', labelKey: 'settings', group: 'app', defaultBinding: chord(',', { ctrl: true }) },
  { id: 'show-shortcuts', labelKey: 'keyboardShortcuts', group: 'app', defaultBinding: chord('/', { ctrl: true }) },
  { id: 'toggle-code-view', labelKey: 'toggleCodeView', group: 'app', defaultBinding: chord('v', { ctrl: true, shift: true }) },
  { id: 'find-in-document', labelKey: 'findInCurrentDocument', group: 'app', defaultBinding: chord('f', { ctrl: true }) },
  { id: 'search-workspace', labelKey: 'searchWorkspace', group: 'app', defaultBinding: chord('e', { ctrl: true, shift: true }) },
  { id: 'toggle-diff', labelKey: 'changes', group: 'app', defaultBinding: chord('d', { ctrl: true, shift: true }) },
  { id: 'compare-tabs', labelKey: 'compareTabs', group: 'app', defaultBinding: chord('c', { ctrl: true, shift: true }) },
  { id: 'toggle-toc', labelKey: 'tableOfContents', group: 'app', defaultBinding: chord('t', { ctrl: true, shift: true }) },
  { id: 'zoom-in', labelKey: 'zoomIn', group: 'app', defaultBinding: chord('=', { ctrl: true }) },
  { id: 'zoom-out', labelKey: 'zoomOut', group: 'app', defaultBinding: chord('-', { ctrl: true }) },
  { id: 'zoom-reset', labelKey: 'resetZoom', group: 'app', defaultBinding: chord('0', { ctrl: true }) },
  { id: 'report-feedback', labelKey: 'reportFeedback', group: 'app', defaultBinding: null },

  { id: 'bold', labelKey: 'bold', group: 'writing', defaultBinding: chord('b', { ctrl: true }) },
  { id: 'italic', labelKey: 'italic', group: 'writing', defaultBinding: chord('i', { ctrl: true }) },
  { id: 'strikethrough', labelKey: 'strikethrough', group: 'writing', defaultBinding: null },
  { id: 'inline-code', labelKey: 'inlineCode', group: 'writing', defaultBinding: null },
  { id: 'highlight', labelKey: 'highlight', group: 'writing', defaultBinding: null },
  { id: 'bullet-list', labelKey: 'bulletList', group: 'writing', defaultBinding: null },
  { id: 'ordered-list', labelKey: 'orderedList', group: 'writing', defaultBinding: null },
  { id: 'task-list', labelKey: 'taskList', group: 'writing', defaultBinding: null },
  { id: 'blockquote', labelKey: 'blockquote', group: 'writing', defaultBinding: null },
  { id: 'code-block', labelKey: 'codeBlock', group: 'writing', defaultBinding: null },
  { id: 'horizontal-rule', labelKey: 'horizontalRule', group: 'writing', defaultBinding: null },
  { id: 'page-break', labelKey: 'pageBreak', group: 'writing', defaultBinding: null },
  { id: 'math-inline', labelKey: 'mathInline', group: 'writing', defaultBinding: null },
  { id: 'math-block', labelKey: 'mathBlock', group: 'writing', defaultBinding: null },
  { id: 'link', labelKey: 'link', group: 'writing', defaultBinding: null },
  { id: 'image', labelKey: 'image', group: 'writing', defaultBinding: null },
  { id: 'table', labelKey: 'table', group: 'writing', defaultBinding: null },
  { id: 'mermaid', labelKey: 'mermaid', group: 'writing', defaultBinding: null },
  { id: 'footnote', labelKey: 'footnote', group: 'writing', defaultBinding: null },
  { id: 'undo', labelKey: 'undo', group: 'writing', defaultBinding: chord('z', { ctrl: true }) },
  { id: 'redo', labelKey: 'redo', group: 'writing', defaultBinding: chord('y', { ctrl: true }) },
];

export function defaultKeybindMap(): Record<string, KeyChord | null> {
  const out: Record<string, KeyChord | null> = {};
  for (const a of KEYBIND_ACTIONS) out[a.id] = a.defaultBinding ? { ...a.defaultBinding } : null;
  return out;
}

export function chordsEqual(a: KeyChord | null, b: KeyChord | null): boolean {
  if (!a || !b) return a === b;
  return a.key === b.key && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt;
}

export function eventToChord(event: KeyboardEvent): KeyChord {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return {
    key,
    ctrl: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}

export function formatChord(c: KeyChord | null, unboundLabel = 'None'): string {
  if (!c) return unboundLabel;
  const parts: string[] = [];
  if (c.ctrl) parts.push('Ctrl');
  if (c.alt) parts.push('Alt');
  if (c.shift) parts.push('Shift');
  const keyLabel = c.key.length === 1 ? c.key.toUpperCase() : c.key;
  parts.push(keyLabel);
  return parts.join('+');
}

export function matchActionId(
  event: KeyboardEvent,
  map: Record<string, KeyChord | null>,
): string | null {
  const chord = eventToChord(event);
  // Ignore modifier-only keydowns.
  if (['Control', 'Shift', 'Alt', 'Meta', 'Dead'].includes(event.key)) return null;
  for (const action of KEYBIND_ACTIONS) {
    const bound = map[action.id];
    if (chordsEqual(bound, chord)) return action.id;
  }
  return null;
}
