<!-- ABOUTME: Collapsed activity line for Read/Grep/Shell tool calls.
     ABOUTME: Keeps the chat readable; details stay behind a disclosure. -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from '../../i18n';
import type { AiMessage } from '../../composables/useAi';
import { summarizeActivity } from '../../utils/ai-message-groups';
import AiMessageView from './AiMessage.vue';

const { t } = useI18n();

const props = defineProps<{
  messages: AiMessage[];
}>();

const open = ref(false);

function onToggle(e: Event) {
  open.value = (e.target as HTMLDetailsElement).open;
}

const summary = computed(() => {
  const { searches, commands } = summarizeActivity(props.messages);
  return t.value.aiActivitySummary(searches, commands);
});
</script>

<template>
  <details class="ai-activity" @toggle="onToggle">
    <summary class="ai-activity__summary">
      <span class="ai-activity__dots" aria-hidden="true" />
      <span>{{ summary }}</span>
      <span class="ai-activity__hint">{{ t.aiActivityDetails }}</span>
    </summary>
    <div v-if="open" class="ai-activity__body">
      <AiMessageView
        v-for="(m, i) in messages"
        :key="i"
        :message="m"
        :has-fence="false"
      />
    </div>
  </details>
</template>

<style scoped>
.ai-activity {
  font-size: 12px;
  color: var(--text-muted);
}
.ai-activity__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.ai-activity__summary::-webkit-details-marker { display: none; }
.ai-activity__dots {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  opacity: 0.6;
}
.ai-activity__hint {
  margin-left: auto;
  font-size: 11px;
  opacity: 0.7;
}
.ai-activity__body {
  margin-top: 6px;
  padding-left: 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
