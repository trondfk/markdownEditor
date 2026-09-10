<!-- ABOUTME: Settings tab for capturing custom keyboard shortcuts.
     ABOUTME: Writes the same store the app dispatcher and shortcuts modal read. -->
<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from '../i18n';
import { useKeybinds } from '../composables/useKeybinds';
import { eventToChord, formatChord, type KeybindActionDef, type KeyChord } from '../data/keybindActions';

const { t } = useI18n();
const keybinds = useKeybinds();
const capturingId = ref<string | null>(null);
const conflictId = ref<string | null>(null);

function labelFor(action: KeybindActionDef): string {
  const dict = t.value as unknown as Record<string, string>;
  return dict[action.labelKey] || action.id;
}

function startCapture(id: string) {
  capturingId.value = id;
  conflictId.value = null;
}

function onCaptureKey(event: KeyboardEvent, id: string) {
  if (capturingId.value !== id) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') {
    keybinds.setBinding(id, null);
    capturingId.value = null;
    return;
  }
  if (event.key === 'Enter') {
    capturingId.value = null;
    return;
  }
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
  const chord: KeyChord = eventToChord(event);
  const conflict = keybinds.setBinding(id, chord);
  if (conflict) {
    conflictId.value = conflict;
    return;
  }
  capturingId.value = null;
  conflictId.value = null;
}

function chordLabel(id: string): string {
  return formatChord(keybinds.bindingFor(id), t.value.shortcutsUnbound);
}
</script>

<template>
  <div class="kb-tab">
    <p class="kb-hint">{{ t.shortcutsCaptureHint }}</p>
    <p v-if="conflictId" class="kb-conflict">{{ t.shortcutsConflict }} ({{ conflictId }})</p>
    <ul class="kb-list">
      <li v-for="action in keybinds.actions" :key="action.id" class="kb-row">
        <span class="kb-label">{{ labelFor(action) }}</span>
        <button
          type="button"
          class="kb-bind"
          :class="{ 'kb-bind--active': capturingId === action.id }"
          @click="startCapture(action.id)"
          @keydown="onCaptureKey($event, action.id)"
        >
          {{ capturingId === action.id ? t.shortcutsPressKey : chordLabel(action.id) }}
        </button>
      </li>
    </ul>
    <button type="button" class="kb-reset" @click="keybinds.resetToDefaults()">{{ t.shortcutsReset }}</button>
  </div>
</template>

<style scoped>
.kb-hint, .kb-conflict {
  font-size: 13px;
  color: var(--text-muted);
}
.kb-conflict { color: #b45309; }
.kb-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 420px;
  overflow: auto;
}
.kb-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
}
.kb-label { font-size: 13px; }
.kb-bind {
  min-width: 140px;
  text-align: right;
  font-family: var(--code-font-family, monospace);
  font-size: 12px;
  border: 1px solid var(--border-primary);
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
}
.kb-bind--active {
  border-color: var(--primary);
}
.kb-reset {
  margin-top: 12px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-primary);
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
}
</style>
