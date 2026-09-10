// ABOUTME: Persists user-customizable keyboard shortcuts.
// ABOUTME: Shared by Settings, the shortcuts modal, and App.vue dispatch.

import { computed, ref, watch } from 'vue';
import {
  chordsEqual,
  defaultKeybindMap,
  formatChord,
  KEYBIND_ACTIONS,
  matchActionId,
  type KeyChord,
} from '../data/keybindActions';

const STORAGE_KEY = 'mermark-keybinds';
const VERSION = 1;

interface KeybindStore {
  version: number;
  map: Record<string, KeyChord | null>;
}

function load(): KeybindStore {
  const defaults = defaultKeybindMap();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: VERSION, map: defaults };
    const parsed = JSON.parse(raw) as KeybindStore;
    if (!parsed || parsed.version !== VERSION || !parsed.map) {
      return { version: VERSION, map: defaults };
    }
    const map = { ...defaults };
    for (const a of KEYBIND_ACTIONS) {
      if (a.id in parsed.map) map[a.id] = parsed.map[a.id];
    }
    return { version: VERSION, map };
  } catch (e) {
    console.error('[useKeybinds] load failed:', e);
    return { version: VERSION, map: defaults };
  }
}

const store = ref<KeybindStore>(load());

watch(store, (s) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (e) {
    console.error('[useKeybinds] save failed:', e);
  }
}, { deep: true });

export function useKeybinds() {
  const map = computed(() => store.value.map);

  function bindingFor(id: string): KeyChord | null {
    return store.value.map[id] ?? null;
  }

  function conflictFor(id: string, chord: KeyChord | null): string | null {
    if (!chord) return null;
    for (const a of KEYBIND_ACTIONS) {
      if (a.id === id) continue;
      if (chordsEqual(store.value.map[a.id], chord)) return a.id;
    }
    return null;
  }

  function setBinding(id: string, chord: KeyChord | null): string | null {
    const conflict = conflictFor(id, chord);
    if (conflict) return conflict;
    store.value.map[id] = chord;
    return null;
  }

  function resetToDefaults() {
    store.value = { version: VERSION, map: defaultKeybindMap() };
  }

  function actionForEvent(event: KeyboardEvent): string | null {
    return matchActionId(event, store.value.map);
  }

  function labelFor(id: string, unbound = 'None'): string {
    return formatChord(bindingFor(id), unbound);
  }

  return {
    actions: KEYBIND_ACTIONS,
    map,
    bindingFor,
    setBinding,
    conflictFor,
    resetToDefaults,
    actionForEvent,
    labelFor,
  };
}
