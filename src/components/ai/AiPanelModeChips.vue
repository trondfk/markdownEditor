<!-- ABOUTME: Ask / Agent / Plan chips next to the model picker.
     ABOUTME: Mode is persisted in settings and gates write tools per send. -->
<script setup lang="ts">
import { useI18n } from '../../i18n';
import type { AssistantMode } from '../../composables/useSettings';

defineProps<{
  mode: AssistantMode;
}>();

const emit = defineEmits<{
  'update:mode': [value: AssistantMode];
}>();

const { t } = useI18n();

const modes: AssistantMode[] = ['ask', 'agent', 'plan'];

function label(m: AssistantMode): string {
  if (m === 'ask') return t.value.aiModeAsk;
  if (m === 'plan') return t.value.aiModePlan;
  return t.value.aiModeAgent;
}
</script>

<template>
  <div class="ai-mode" role="group" :aria-label="t.aiModeAgent">
    <button
      v-for="m in modes"
      :key="m"
      type="button"
      class="ai-mode__btn"
      :class="{ 'ai-mode__btn--on': mode === m }"
      @click="emit('update:mode', m)"
    >{{ label(m) }}</button>
  </div>
</template>

<style scoped>
.ai-mode {
  display: inline-flex;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  overflow: hidden;
  flex: 0 0 auto;
}
.ai-mode__btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  padding: 4px 8px;
  cursor: pointer;
}
.ai-mode__btn--on {
  background: var(--bg-secondary);
  color: var(--text-primary);
}
</style>
