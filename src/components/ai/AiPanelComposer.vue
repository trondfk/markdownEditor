<script setup lang="ts">
import AiPanelPinList from './AiPanelPinList.vue';
import AiPanelImageStrip from './AiPanelImageStrip.vue';
import { computed, ref } from 'vue';
import { useI18n } from '../../i18n';
import type { PendingImage } from '../../composables/useAiPendingImages';
import type { PinnedItem } from '../../composables/useAiPinnedSelections';
import { applyMention, atQuery, filterMentions, type MentionItem } from '../../utils/ai-mentions';
import type { AttachedRef } from '../../composables/useAiPreamble';

const { t } = useI18n();

const props = defineProps<{
  inputValue: string;
  cliConnected: boolean;
  modelMissing?: boolean;
  isSending: boolean;
  isStalled?: boolean;
  sendingOtherThread?: boolean;
  authRequiredHint: string;
  sendButtonText: string;
  cancelButtonText: string;
  docTooLarge: boolean;
  docMarkdownLengthKb: number;
  sendFullDocOverride: boolean;
  pinnedSelections: PinnedItem[];
  includePinned: boolean;
  showLiveSelection: boolean;
  liveSelectionText: string | null;
  pinPreview: (text: string, max?: number) => string;
  pendingImages: PendingImage[];
  localNoVision?: boolean;
  mentionItems?: MentionItem[];
  attachedFiles?: AttachedRef[];
}>();

const emit = defineEmits<{
  'update:inputValue': [value: string];
  'update:sendFullDocOverride': [value: boolean];
  'update:includePinned': [value: boolean];
  send: [];
  cancel: [];
  paste: [e: ClipboardEvent];
  pickImage: [];
  pin: [];
  removePin: [id: string];
  clearPins: [];
  previewImage: [img: PendingImage];
  removeImage: [id: string];
  clearImages: [];
  openSettings: [];
  attachMention: [item: MentionItem];
  removeAttachment: [path: string];
  pickMentionFile: [];
}>();

const caret = ref(0);
const mentionIndex = ref(0);

const mentionHit = computed(() => atQuery(props.inputValue, caret.value));
const mentionChoices = computed(() => {
  if (!mentionHit.value) return [];
  return filterMentions(props.mentionItems ?? [], mentionHit.value.query);
});

function onInput(e: Event) {
  const el = e.target as HTMLTextAreaElement;
  caret.value = el.selectionStart;
  emit('update:inputValue', el.value);
}

function pickMention(item: MentionItem) {
  const next = applyMention(props.inputValue, caret.value, item);
  if (next) {
    emit('update:inputValue', next.text);
    caret.value = next.caret;
  }
  emit('attachMention', item);
}

function onKeydown(e: KeyboardEvent) {
  if (mentionHit.value && mentionChoices.value.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mentionIndex.value = (mentionIndex.value + 1) % mentionChoices.value.length;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      mentionIndex.value = (mentionIndex.value - 1 + mentionChoices.value.length) % mentionChoices.value.length;
      return;
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      pickMention(mentionChoices.value[mentionIndex.value]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      caret.value = 0;
      return;
    }
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    emit('send');
  }
}

function onOverrideToggle(e: Event) {
  emit('update:sendFullDocOverride', (e.target as HTMLInputElement).checked);
}
</script>

<template>
  <footer class="ai-panel__composer">
    <div v-if="docTooLarge" class="ai-panel__warn">
      Document is large ({{ docMarkdownLengthKb }} KB).
      <label><input type="checkbox" :checked="sendFullDocOverride" @change="onOverrideToggle" /> Send full document</label>
    </div>
    <p v-if="localNoVision" class="ai-panel__warn ai-panel__warn--info">{{ t.aiLocalNoVision }}</p>

    <AiPanelPinList
      :pins="pinnedSelections"
      :include-pinned="includePinned"
      :show-live="showLiveSelection"
      :live-text="liveSelectionText"
      :preview="pinPreview"
      @update:include-pinned="(v) => emit('update:includePinned', v)"
      @pin="emit('pin')"
      @remove="(id) => emit('removePin', id)"
      @clear-all="emit('clearPins')"
    />

    <AiPanelImageStrip
      :images="pendingImages"
      @preview="(img) => emit('previewImage', img)"
      @remove="(id) => emit('removeImage', id)"
      @clear="emit('clearImages')"
    />

    <div v-if="attachedFiles && attachedFiles.length > 0" class="ai-panel__attached">
      <span>{{ t.aiAttachedFiles }}</span>
      <button
        v-for="f in attachedFiles"
        :key="f.path"
        type="button"
        class="ai-panel__attached-chip"
        :title="f.path"
        @click="emit('removeAttachment', f.path)"
      >{{ f.name }} ×</button>
    </div>

    <div class="ai-panel__input-wrap">
      <ul v-if="mentionHit && mentionChoices.length > 0" class="ai-panel__mentions">
        <li
          v-for="(item, i) in mentionChoices"
          :key="item.path"
        >
          <button
            type="button"
            :class="{ 'ai-panel__mention--on': i === mentionIndex }"
            @mousedown.prevent="pickMention(item)"
          >{{ item.kind === 'folder' ? '📁 ' : '' }}{{ item.name }}</button>
        </li>
      </ul>
      <p v-else-if="mentionHit" class="ai-panel__mentions-empty">
        {{ t.aiMentionEmpty }}
        <button type="button" @click="emit('pickMentionFile')">{{ t.aiMentionPickFile }}</button>
      </p>
      <textarea
        :value="inputValue"
        @input="onInput"
        class="ai-panel__input"
        :placeholder="cliConnected ? t.aiComposerPlaceholder : authRequiredHint"
        :disabled="!cliConnected"
        rows="2"
        @keydown="onKeydown"
        @click="onInput"
        @keyup="onInput"
        @select="onInput"
        @paste="(e) => emit('paste', e)"
      />
      <div class="ai-panel__composer-actions">
        <button class="ai-panel__btn ai-panel__btn--icon" @click="emit('pickImage')" :disabled="!cliConnected" :title="t.aiAttachImage">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </button>
        <slot name="model" />
        <slot name="mode" />
        <button class="ai-panel__btn ai-panel__btn--icon" @click="emit('openSettings')" :title="t.aiComposerSettings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <span v-if="modelMissing" class="ai-panel__hint ai-panel__hint--warn">{{ t.aiModelMissing }}</span>
        <span v-else-if="sendingOtherThread" class="ai-panel__hint">{{ t.aiSendingOtherThread }}</span>
        <span class="ai-panel__actions-spacer" />
        <button
          v-if="isSending"
          class="ai-panel__btn"
          :class="isStalled ? 'ai-panel__btn--stall' : 'ai-panel__btn--secondary'"
          @click="emit('cancel')"
        >{{ cancelButtonText }}</button>
        <button
          v-else
          class="ai-panel__btn ai-panel__btn--primary"
          :title="t.aiEmptyKeyHint"
          @click="emit('send')"
          :disabled="!inputValue.trim() || !cliConnected || modelMissing || sendingOtherThread"
        >{{ sendButtonText }}</button>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.ai-panel__composer {
  border-top: 1px solid var(--border-primary);
  padding: 10px 12px 12px;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ai-panel__warn {
  font-size: 12px;
  background: var(--diff-removed-bg, rgba(239, 68, 68, 0.08));
  color: var(--diff-removed-text, #dc2626);
  padding: 6px 8px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
}
.ai-panel__warn--info {
  background: var(--bg-tertiary);
  color: var(--text-muted);
}
.ai-panel__input-wrap {
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  background: var(--bg-input, var(--bg-secondary));
  padding: 8px 8px 6px;
  overflow: visible;
}
.ai-panel__input {
  width: 100%;
  resize: none;
  min-height: 44px;
  padding: 4px 6px;
  background: transparent;
  color: var(--text-primary);
  border: none;
  font-family: inherit;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}
.ai-panel__input:disabled { opacity: .6; cursor: not-allowed; }

.ai-panel__composer-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.ai-panel__attached {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 11px;
  color: var(--text-muted);
}
.ai-panel__attached-chip {
  border: 1px solid var(--border-primary);
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-radius: 999px;
  padding: 2px 8px;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}
.ai-panel__mentions {
  list-style: none;
  margin: 0 0 6px;
  padding: 0;
  max-height: 160px;
  overflow: auto;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  background: var(--bg-primary);
}
.ai-panel__mentions button {
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--text-primary);
  padding: 6px 8px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.ai-panel__mention--on,
.ai-panel__mentions button:hover {
  background: var(--bg-secondary);
}
.ai-panel__mentions-empty {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--text-muted);
  display: flex;
  gap: 8px;
  align-items: center;
}
.ai-panel__actions-spacer {
  flex: 1;
  min-width: 0;
}
.ai-panel__hint {
  font-size: 11px;
  color: var(--text-muted);
}
.ai-panel__hint--warn {
  color: #b45309;
}
.ai-panel__btn {
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
}
.ai-panel__btn--primary {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}
.ai-panel__btn--primary:hover:not(:disabled) { filter: brightness(1.1); }
.ai-panel__btn--primary:disabled { opacity: .5; cursor: not-allowed; }
.ai-panel__btn--secondary {
  background: var(--bg-primary);
  color: var(--text-primary);
  border-color: var(--border-primary);
}
.ai-panel__btn--stall {
  background: #b45309;
  color: #fff;
  border-color: #b45309;
}
.ai-panel__btn--icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--text-secondary);
  cursor: pointer;
}
.ai-panel__btn--icon:hover { background: var(--hover-bg); color: var(--text-primary); }
.ai-panel__btn--icon:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
