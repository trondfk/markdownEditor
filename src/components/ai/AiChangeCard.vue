<!-- ABOUTME: Cursor-like file-change card for Write/Edit tool calls.
     ABOUTME: Keep leaves the disk write; Undo restores the last snapshot. -->
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../../i18n';
import type { AiMessage } from '../../composables/useAi';
import { extractToolFilePath, fileNameFromPath } from '../../utils/ai-tool-kind';

const { t } = useI18n();

const props = defineProps<{
  message: AiMessage;
  index: number;
  isActiveDoc: boolean;
}>();

const emit = defineEmits<{
  keep: [index: number];
  undo: [index: number];
  showDiff: [index: number];
}>();

const filePath = computed(() => extractToolFilePath(props.message.text) ?? '');
const fileName = computed(() => filePath.value ? fileNameFromPath(filePath.value) : (props.message.tool || 'file'));
const status = computed(() => props.message.changeStatus ?? 'pending');
</script>

<template>
  <div class="ai-change" :class="`ai-change--${status}`">
    <div class="ai-change__row">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <span class="ai-change__label">{{ t.aiChangeEdited }}</span>
      <strong class="ai-change__file" :title="filePath">{{ fileName }}</strong>
    </div>
    <div v-if="status === 'pending'" class="ai-change__actions">
      <button type="button" class="ai-change__btn ai-change__btn--keep" @click="emit('keep', index)">{{ t.aiChangeKeep }}</button>
      <button type="button" class="ai-change__btn" @click="emit('undo', index)">{{ t.aiChangeUndo }}</button>
      <button v-if="filePath" type="button" class="ai-change__btn" @click="emit('showDiff', index)">{{ t.aiChangeShowDiff }}</button>
    </div>
    <div v-else class="ai-change__status">
      {{ status === 'kept' ? t.aiChangeKept : t.aiChangeUndone }}
    </div>
  </div>
</template>

<style scoped>
.ai-change {
  border: 1px solid var(--border-primary);
  background: var(--bg-secondary);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12px;
}
.ai-change__row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
}
.ai-change__file {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-change__actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.ai-change__btn {
  border: 1px solid var(--border-primary);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.ai-change__btn--keep {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}
.ai-change__status {
  margin-top: 6px;
  color: var(--text-muted);
}
</style>
