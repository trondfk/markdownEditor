<!-- ABOUTME: Compact chip strip for live editor selection and pinned fragments.
     ABOUTME: Live chip grows with the selection, then Show more reveals the rest. -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from '../../i18n';
import type { PinnedItem } from '../../composables/useAiPinnedSelections';

const { t } = useI18n();

const props = defineProps<{
  pins: PinnedItem[];
  includePinned: boolean;
  showLive: boolean;
  liveText: string | null;
  preview: (text: string, max?: number) => string;
}>();

const emit = defineEmits<{
  'update:includePinned': [value: boolean];
  pin: [];
  remove: [id: string];
  clearAll: [];
}>();

/** About one composer-width line of 11px monospace before "Show more". */
const LIVE_LINE_CHARS = 96;

function previewOf(text: string): string {
  return props.preview(text, 72);
}

const liveEl = ref<HTMLElement | null>(null);
const liveExpanded = ref(false);
const liveOverflows = ref(false);

const liveFull = computed(() => props.liveText ?? '');

const liveNeedsMore = computed(() => {
  const text = liveFull.value;
  if (!text) return false;
  return text.length > LIVE_LINE_CHARS || text.includes('\n') || liveOverflows.value;
});

async function measureLive() {
  await nextTick();
  const el = liveEl.value;
  if (!el || liveExpanded.value) return;
  liveOverflows.value = el.scrollWidth > el.clientWidth + 1;
}

watch(
  () => props.liveText,
  () => {
    liveExpanded.value = false;
    liveOverflows.value = false;
    void measureLive();
  },
  { immediate: true },
);

onMounted(() => {
  void measureLive();
});

function toggleLiveExpand() {
  liveExpanded.value = !liveExpanded.value;
  if (!liveExpanded.value) void measureLive();
}

function onToggle(e: Event) {
  emit('update:includePinned', (e.target as HTMLInputElement).checked);
}
</script>

<template>
  <div v-if="pins.length > 0 || showLive" class="ai-panel__pinned">
    <div v-if="pins.length > 0" class="ai-panel__pinned-head">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76A2 2 0 0 1 8 9V3h8v6a2 2 0 0 1-1 1.76l-1 .58a2 2 0 0 0-1 1.76V17H10v-3.93a2 2 0 0 0-1-1.74l-1-.57z"/></svg>
      <span class="ai-panel__pinned-label">{{ t.aiPinCount(pins.length) }}</span>
      <label class="ai-panel__pinned-toggle">
        <input type="checkbox" :checked="includePinned" @change="onToggle" />
        <span>{{ t.aiPinSendLabel }}</span>
      </label>
      <button class="ai-panel__pinned-action ai-panel__pinned-action--clear" @click="emit('clearAll')" :title="t.aiPinClearAllTooltip">{{ t.aiPinClearAll }}</button>
    </div>
    <ul v-if="pins.length > 0" class="ai-panel__pin-list">
      <li v-for="(p, i) in pins" :key="p.id" class="ai-panel__pin-item">
        <span class="ai-panel__pin-num">#{{ i + 1 }}</span>
        <span class="ai-panel__pin-text" :title="p.text">{{ previewOf(p.text) }}</span>
        <button class="ai-panel__pin-rm" @click="emit('remove', p.id)" :title="t.aiPinRemoveTooltip">×</button>
      </li>
    </ul>
    <div v-if="showLive" class="ai-panel__pin-live" :class="{ 'ai-panel__pin-live--open': liveExpanded }">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76A2 2 0 0 1 8 9V3h8v6a2 2 0 0 1-1 1.76l-1 .58a2 2 0 0 0-1 1.76V17H10v-3.93a2 2 0 0 0-1-1.74l-1-.57z"/></svg>
      <span
        ref="liveEl"
        class="ai-panel__pin-live-text"
        :class="{ 'ai-panel__pin-live-text--open': liveExpanded }"
        :title="liveFull"
      >{{ liveFull }}</span>
      <button
        v-if="liveNeedsMore || liveExpanded"
        type="button"
        class="ai-panel__pin-more"
        :aria-expanded="liveExpanded"
        @click="toggleLiveExpand"
      >{{ liveExpanded ? t.aiPinSeeLess : t.aiPinSeeMore }}</button>
      <button class="ai-panel__pinned-action" :title="t.aiPinLiveLabel" @click="emit('pin')">{{ t.aiPinAdd }}</button>
    </div>
  </div>
</template>

<style scoped>
.ai-panel__pinned {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.ai-panel__pinned-head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  min-height: 22px;
}
.ai-panel__pinned-label {
  font-weight: 600;
  font-size: 11px;
  color: var(--text-secondary, var(--text-muted));
}
.ai-panel__pinned-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  font-size: 11px;
  cursor: pointer;
}
.ai-panel__pinned-action {
  padding: 1px 8px;
  font-size: 11px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  flex: 0 0 auto;
}
.ai-panel__pinned-action:hover { filter: brightness(1.1); }
.ai-panel__pinned-action--clear {
  background: transparent;
  color: var(--danger);
  border: 1px solid var(--danger);
  margin-left: 0;
}
.ai-panel__pinned-action--clear:hover {
  background: var(--danger);
  color: #fff;
  filter: none;
}
.ai-panel__pin-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 72px;
  overflow-y: auto;
}
.ai-panel__pin-item {
  display: grid;
  grid-template-columns: 22px 1fr auto;
  gap: 6px;
  align-items: center;
  padding: 2px 6px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 5px;
  font-size: 11px;
}
.ai-panel__pin-num {
  font-weight: 700;
  color: var(--primary);
  font-family: var(--code-font-family, monospace);
}
.ai-panel__pin-text {
  font-family: var(--code-font-family, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
}
.ai-panel__pin-rm {
  background: transparent;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 4px;
  border-radius: 3px;
}
.ai-panel__pin-rm:hover { color: var(--danger); background: var(--hover-bg); }

.ai-panel__pin-live {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  max-width: 100%;
  gap: 6px;
  min-height: 26px;
  padding: 2px 6px 2px 8px;
  background: var(--bg-secondary);
  border: 1px dashed var(--border-primary);
  border-radius: 6px;
  color: var(--text-muted);
  box-sizing: border-box;
}
.ai-panel__pin-live--open {
  align-self: stretch;
  width: 100%;
  align-items: flex-start;
  padding-top: 6px;
  padding-bottom: 6px;
}
.ai-panel__pin-live-text {
  flex: 0 1 auto;
  min-width: 0;
  font-family: var(--code-font-family, monospace);
  font-size: 11px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ai-panel__pin-live-text--open {
  flex: 1 1 auto;
  white-space: pre-wrap;
  overflow: auto;
  max-height: 12em;
  word-break: break-word;
}
.ai-panel__pin-more {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  color: var(--primary);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 0 2px;
  white-space: nowrap;
}
.ai-panel__pin-more:hover { text-decoration: underline; }
</style>
