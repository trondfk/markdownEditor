<!-- ABOUTME: Cursor-like file-change card for Write/Edit tool calls.
     ABOUTME: Inline hunks plus Keep/Undo; full overlay remains available. -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from '../../i18n';
import type { AiMessage } from '../../composables/useAi';
import type { ChangeDiff } from '../../utils/ai-change-diff';
import { collapseDiffRows, diffFromToolArgs } from '../../utils/ai-change-diff';
import { extractToolFilePath, fileNameFromPath } from '../../utils/ai-tool-kind';

const { t } = useI18n();

const props = defineProps<{
  message: AiMessage;
  index: number;
  isActiveDoc: boolean;
  fileDiff?: ChangeDiff | null;
}>();

const emit = defineEmits<{
  keep: [index: number];
  undo: [index: number];
  showDiff: [index: number];
}>();

const previewOpen = ref(true);
const showAllLines = ref(false);

const filePath = computed(() => extractToolFilePath(props.message.text) ?? '');
const fileName = computed(() => filePath.value ? fileNameFromPath(filePath.value) : (props.message.tool || 'file'));
const status = computed(() => props.message.changeStatus ?? 'pending');

const diff = computed<ChangeDiff | null>(() => {
  const fromArgs = diffFromToolArgs(props.message.text);
  const file = props.fileDiff ?? null;
  if (file && file.stats.additions + file.stats.deletions > 0) return file;
  return fromArgs ?? file;
});

const stats = computed(() => diff.value?.stats ?? { additions: 0, deletions: 0 });
const hasDiff = computed(() => (stats.value.additions + stats.value.deletions) > 0);

const rows = computed(() => {
  const lines = diff.value?.lines ?? [];
  if (showAllLines.value) return lines.map(line => ({ kind: 'line' as const, line }));
  return collapseDiffRows(lines);
});

function togglePreview() {
  previewOpen.value = !previewOpen.value;
}

function onGapClick() {
  showAllLines.value = true;
}
</script>

<template>
  <div class="ai-change" :class="`ai-change--${status}`">
    <button type="button" class="ai-change__row" @click="togglePreview">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <span class="ai-change__label">{{ t.aiChangeEdited }}</span>
      <strong class="ai-change__file" :title="filePath">{{ fileName }}</strong>
      <span v-if="hasDiff" class="ai-change__stats">
        <span class="ai-change__stat ai-change__stat--add">+{{ stats.additions }}</span>
        <span class="ai-change__stat ai-change__stat--del">-{{ stats.deletions }}</span>
      </span>
    </button>
    <div v-if="previewOpen && hasDiff" class="ai-change__diff">
      <div
        v-for="(row, ri) in rows"
        :key="ri"
        class="ai-change__diff-row"
        :class="row.kind === 'gap' ? 'ai-change__gap' : ('ai-change__line ai-change__line--' + row.line.type)"
      >
        <button
          v-if="row.kind === 'gap'"
          type="button"
          class="ai-change__gap-btn"
          @click="onGapClick"
        >{{ t.aiChangeHiddenLines(row.hidden) }}</button>
        <template v-else>
          <span class="ai-change__num">{{ row.line.newLineNumber ?? row.line.oldLineNumber ?? '' }}</span>
          <span class="ai-change__prefix">{{ row.line.type === 'added' ? '+' : row.line.type === 'removed' ? '-' : ' ' }}</span>
          <span class="ai-change__content">
            <template v-if="row.line.segments && row.line.segments.length">
              <span
                v-for="(seg, si) in row.line.segments"
                :key="si"
                :class="seg.highlight ? ('ai-change__word ai-change__word--' + row.line.type) : ''"
              >{{ seg.value }}</span>
            </template>
            <template v-else>{{ row.line.content || ' ' }}</template>
          </span>
        </template>
      </div>
    </div>
    <div v-if="status === 'pending'" class="ai-change__actions">
      <button type="button" class="ai-change__btn ai-change__btn--keep" @click="emit('keep', index)">{{ t.aiChangeKeep }}</button>
      <button type="button" class="ai-change__btn" @click="emit('undo', index)">{{ t.aiChangeUndo }}</button>
      <button v-if="filePath || hasDiff" type="button" class="ai-change__btn" @click="emit('showDiff', index)">{{ t.aiChangeShowDiff }}</button>
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
  width: 100%;
  border: 0;
  background: none;
  padding: 0;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}
.ai-change__file {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-change__stats {
  margin-left: auto;
  display: flex;
  gap: 6px;
  font-family: "Fira Code", "Consolas", monospace;
  font-weight: 600;
  flex-shrink: 0;
}
.ai-change__stat--add { color: var(--diff-added-text); }
.ai-change__stat--del { color: var(--diff-removed-text); }
.ai-change__diff {
  margin-top: 8px;
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  background: var(--bg-primary);
  font-family: "Fira Code", "Consolas", monospace;
  font-size: 11px;
  line-height: 1.45;
}
.ai-change__line {
  display: flex;
  white-space: pre;
  min-height: 18px;
}
.ai-change__line--added {
  background: var(--diff-added-bg);
  color: var(--diff-added-text);
}
.ai-change__line--removed {
  background: var(--diff-removed-bg);
  color: var(--diff-removed-text);
}
.ai-change__line--unchanged {
  color: var(--text-secondary);
}
.ai-change__num {
  display: inline-block;
  width: 36px;
  text-align: right;
  padding-right: 6px;
  color: var(--text-faint);
  user-select: none;
  flex-shrink: 0;
}
.ai-change__prefix {
  display: inline-block;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
  user-select: none;
  font-weight: 600;
}
.ai-change__content {
  flex: 1;
  padding-right: 8px;
}
.ai-change__word--added {
  background: var(--diff-word-added-bg, rgba(46, 160, 67, 0.4));
  border-radius: 2px;
}
.ai-change__word--removed {
  background: var(--diff-word-removed-bg, rgba(248, 81, 73, 0.4));
  border-radius: 2px;
}
.ai-change__gap {
  background: var(--bg-tertiary);
}
.ai-change__gap-btn {
  display: block;
  width: 100%;
  border: 0;
  background: none;
  color: var(--text-muted);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
  text-align: left;
}
.ai-change__gap-btn:hover {
  color: var(--text-primary);
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
