<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import AiMessage from './AiMessage.vue';
import AiActivityGroup from './AiActivityGroup.vue';
import AiChangeCard from './AiChangeCard.vue';
import { useI18n } from '../../i18n';
import { parseAiOutput } from '../../composables/useAiOutputParser';
import type { AiMessage as AiMessageType, AttachedPin } from '../../composables/useAi';
import { groupAiMessages } from '../../utils/ai-message-groups';
import { formatElapsed } from '../../utils/format-elapsed';
import { extractToolFilePath } from '../../utils/ai-tool-kind';

const { t } = useI18n();

const props = defineProps<{
  messages: AiMessageType[];
  isSending: boolean;
  isCompacting: boolean;
  emptyHint: string;
  cliConnected: boolean;
  authRequiredHint: string;
  connecting: boolean;
  sendStartedAt: number | null;
  lastToolName: string | null;
  isStalled: boolean;
  activeDocPath: string;
}>();

const emit = defineEmits<{
  linkClick: [url: string];
  showAttachment: [pins: AttachedPin[]];
  keepChange: [index: number];
  undoChange: [index: number];
  showChangeDiff: [index: number];
  cancel: [];
  reportFeedback: [];
}>();

const messagesEl = ref<HTMLElement | null>(null);
const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  tick = setInterval(() => { now.value = Date.now(); }, 1000);
});
onUnmounted(() => {
  if (tick) clearInterval(tick);
});

const groups = computed(() => groupAiMessages(props.messages));

const workingLabel = computed(() => {
  if (props.isCompacting) return t.value.aiCompacting;
  if (props.isStalled) return t.value.aiWorkingStalled;
  if (props.sendStartedAt) {
    const elapsed = formatElapsed(now.value - props.sendStartedAt);
    const tool = props.lastToolName === 'thinking' ? t.value.aiThinking : (props.lastToolName ?? '');
    return t.value.aiWorkingElapsed(elapsed, tool);
  }
  return t.value.aiWorkingPlease;
});

watch(() => props.messages.length, async () => {
  await nextTick();
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
});

function messageHasFence(text: string): boolean {
  return parseAiOutput(text).kind !== 'plain';
}

function isActiveDoc(argsText: string): boolean {
  if (!props.activeDocPath) return false;
  const p = extractToolFilePath(argsText) ?? '';
  return p.replace(/\\/g, '/') === props.activeDocPath.replace(/\\/g, '/');
}

const lastAssistantError = computed(() => {
  for (let i = props.messages.length - 1; i >= 0; i--) {
    const m = props.messages[i];
    if (m.role === 'assistant' && m.error) return true;
    if (m.role === 'assistant' || m.role === 'user') break;
  }
  return false;
});
</script>

<template>
  <div ref="messagesEl" class="ai-panel__messages">
    <div v-if="messages.length === 0 && !connecting && !isSending" class="ai-panel__empty">
      <p>{{ cliConnected ? emptyHint : authRequiredHint }}</p>
    </div>
    <template v-for="(g, gi) in groups" :key="gi">
      <AiActivityGroup v-if="g.type === 'activity'" :messages="g.messages" />
      <AiChangeCard
        v-else-if="g.type === 'change'"
        :message="g.message"
        :index="g.index"
        :is-active-doc="isActiveDoc(g.message.text)"
        @keep="(i) => emit('keepChange', i)"
        @undo="(i) => emit('undoChange', i)"
        @show-diff="(i) => emit('showChangeDiff', i)"
      />
      <AiMessage
        v-else
        :message="g.message"
        :has-fence="g.message.role === 'assistant' && g.message.done && messageHasFence(g.message.text)"
        @link-click="(url: string) => emit('linkClick', url)"
        @show-attachment="(pins) => emit('showAttachment', pins)"
      />
    </template>
    <div v-if="isSending" class="ai-panel__processing" :class="{ 'ai-panel__processing--stalled': isStalled }">
      <span class="ai-msg__thinking-dot" />
      <span class="ai-msg__thinking-dot" />
      <span class="ai-msg__thinking-dot" />
      <span>{{ workingLabel }}</span>
      <button
        v-if="isStalled"
        type="button"
        class="ai-panel__processing-cancel"
        @click="emit('cancel')"
      >{{ t.aiCancelButton }}</button>
    </div>
    <button
      v-if="lastAssistantError && !isSending"
      type="button"
      class="ai-panel__report-error"
      @click="emit('reportFeedback')"
    >{{ t.reportFeedback }}</button>
  </div>
</template>

<style scoped>
.ai-panel__messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ai-panel__empty {
  margin: auto;
  text-align: center;
  color: var(--text-muted);
}
.ai-panel__processing {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 6px 10px;
  background: var(--bg-tertiary);
  border-radius: 999px;
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}
.ai-panel__processing--stalled {
  color: #b45309;
}
.ai-panel__processing-cancel,
.ai-panel__report-error {
  margin-left: 6px;
  border: 1px solid #b45309;
  background: #b45309;
  color: #fff;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}
.ai-panel__report-error {
  align-self: flex-start;
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-color: var(--border-primary);
}
.ai-panel__processing > span:first-child,
.ai-panel__processing > span:nth-child(2),
.ai-panel__processing > span:nth-child(3) {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: ai-msg-bounce 1.2s infinite ease-in-out both;
}
.ai-panel__processing > span:nth-child(1) { animation-delay: 0s; }
.ai-panel__processing > span:nth-child(2) { animation-delay: 0.15s; }
.ai-panel__processing > span:nth-child(3) { animation-delay: 0.3s; }
@keyframes ai-msg-bounce {
  0%, 80%, 100% { opacity: .3; transform: scale(0.7); }
  40% { opacity: 1; transform: scale(1); }
}
</style>
