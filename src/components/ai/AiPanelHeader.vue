<!-- ABOUTME: Title, window controls, and thread actions for the AI panel.
     ABOUTME: Model and CLI picking lives on the composer chip, not here. -->
<script setup lang="ts">
import AiPanelThreadDropdown from './AiPanelThreadDropdown.vue';
import { useI18n } from '../../i18n';
import type { AiThread } from '../../composables/useAi';

const { t } = useI18n();

defineProps<{
  threads: AiThread[];
  activeThreadId: string | null;
  fullscreen: boolean;
  titleText: string;
  fullscreenTitle: string;
  exitFullscreenTitle: string;
  closeTitle: string;
  newChatTitle: string;
}>();

const emit = defineEmits<{
  minimize: [];
  toggleFullscreen: [];
  close: [];
  revert: [];
  newChat: [];
  selectThread: [id: string];
  deleteThread: [id: string];
  threadsRef: [el: HTMLDetailsElement | null];
}>();
</script>

<template>
  <header class="ai-panel__header">
    <div class="ai-panel__title-row">
      <div class="ai-panel__title-group">
        <svg class="ai-panel__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
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
        <strong>{{ titleText }}</strong>
      </div>
      <div class="ai-panel__actions">
        <button
          class="ai-panel__icon-btn"
          @click="emit('revert')"
          :title="t.aiRevertSnapshot"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>
        </button>
        <AiPanelThreadDropdown
          :threads="threads"
          :active-thread-id="activeThreadId"
          @select="(id) => emit('selectThread', id)"
          @delete="(id) => emit('deleteThread', id)"
          @ref="(el) => emit('threadsRef', el)"
        />
        <button class="ai-panel__icon-btn" @click="emit('newChat')" :title="newChatTitle">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
      <div class="ai-panel__window-controls">
        <button class="ai-panel__win-btn" @click="emit('minimize')" :title="t.aiMinimizeToTab">
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="8" width="8" height="1" fill="currentColor"/></svg>
        </button>
        <button class="ai-panel__win-btn" @click="emit('toggleFullscreen')" :title="fullscreen ? exitFullscreenTitle : fullscreenTitle">
          <svg v-if="!fullscreen" width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor"/></svg>
          <svg v-else width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="3" width="6" height="6" fill="none" stroke="currentColor"/><rect x="3" y="1" width="6" height="6" fill="none" stroke="currentColor"/></svg>
        </button>
        <button class="ai-panel__win-btn ai-panel__win-btn--close" @click="emit('close')" :title="`${closeTitle} (Esc)`">
          <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor"/></svg>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.ai-panel__header {
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  background: linear-gradient(180deg, var(--toolbar-gradient-from), var(--toolbar-gradient-to));
  border-bottom: 1px solid var(--border-primary);
}
.ai-panel__icon {
  color: var(--primary);
}
.ai-panel__actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.ai-panel__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 100ms ease, color 100ms ease;
}
.ai-panel__icon-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.ai-panel__title-row {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 6px;
}
.ai-panel__title-group {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  min-width: 0;
}
.ai-panel__window-controls {
  display: flex;
  align-items: center;
  gap: 2px;
}

.ai-panel__win-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 24px;
  background: transparent;
  color: var(--text-secondary, var(--text-muted));
  border: none;
  border-radius: 3px;
  cursor: pointer;
  transition: background 100ms ease, color 100ms ease;
}
.ai-panel__win-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}
.ai-panel__win-btn--close:hover {
  background: var(--danger);
  color: #fff;
}
</style>
