<!-- ABOUTME: Compact model chip for CLI, model, and effort, like Cursor's picker.
     ABOUTME: The full selects only mount while the popover is open. -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { CliKind } from '../../services/aiCommands';
import { CUSTOM_MODEL_SENTINEL } from '../../composables/useAiModels';
import { useI18n } from '../../i18n';

const { t } = useI18n();

interface ModelOption { id: string; label: string; custom?: boolean }
interface EffortOption { id: string; label: string }

const props = defineProps<{
  cli: CliKind;
  availableClis: CliKind[];
  model: string;
  modelOptions: ModelOption[];
  effort: string;
  effortOptions: EffortOption[];
  customModelInput: string;
  isCustomModel: boolean;
  cliConnected: boolean;
  cliAccount: string;
  statusOkLabel: (account: string) => string;
  statusAuthLabel: string;
  modelTitle: string;
  defaultCliTitle: string;
}>();

const emit = defineEmits<{
  'update:cli': [value: CliKind];
  'update:model': [value: string];
  'update:effort': [value: string];
  'update:customModelInput': [value: string];
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const CLI_LABELS: Record<CliKind, string> = { claude: 'Claude', codex: 'Codex', ollama: 'Ollama', openai: 'OpenAI-compatible' };
function cliLabel(c: CliKind): string { return CLI_LABELS[c] ?? c; }

const modelSelectValue = computed(() => props.isCustomModel ? CUSTOM_MODEL_SENTINEL : props.model);

const currentModelLabel = computed(() => {
  if (props.isCustomModel) return props.customModelInput || props.model || t.value.aiModel;
    return props.modelOptions.find(m => m.id === props.model)?.label ?? (props.model || t.value.aiModel);
});

const currentEffortLabel = computed(() =>
  props.effortOptions.find(e => e.id === props.effort)?.label ?? '',
);

const triggerTitle = computed(() => {
  const parts = [cliLabel(props.cli), currentModelLabel.value];
  if (currentEffortLabel.value) parts.push(currentEffortLabel.value);
  return parts.join(' · ');
});

function onModelChange(e: Event) {
  const id = (e.target as HTMLSelectElement).value;
  if (id === CUSTOM_MODEL_SENTINEL) {
    const next = props.customModelInput || props.model;
    emit('update:customModelInput', next);
    emit('update:model', next);
  } else {
    emit('update:model', id);
  }
}

function onCustomModelInput(e: Event) {
  const v = (e.target as HTMLInputElement).value;
  emit('update:customModelInput', v);
  emit('update:model', v);
}

function toggle() {
  open.value = !open.value;
}

function onDocPointer(e: PointerEvent) {
  if (!open.value) return;
  const node = e.target as Node | null;
  if (rootRef.value && node && !rootRef.value.contains(node)) open.value = false;
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value) return;
  e.stopPropagation();
  open.value = false;
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer);
  window.addEventListener('keydown', onKey, true);
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointer);
  window.removeEventListener('keydown', onKey, true);
});
</script>

<template>
  <div ref="rootRef" class="ai-model-picker">
    <button
      type="button"
      class="ai-model-picker__trigger"
      :aria-expanded="open"
      :aria-label="t.aiModelPicker"
      :title="triggerTitle"
      @click="toggle"
    >
      <span
        class="ai-panel__status-dot"
        :class="cliConnected ? 'ai-panel__status-dot--ok' : 'ai-panel__status-dot--err'"
        :title="cliConnected ? statusOkLabel(cliAccount) : statusAuthLabel"
      />
      <span class="ai-model-picker__label">{{ currentModelLabel }}</span>
      <span v-if="currentEffortLabel" class="ai-model-picker__effort">{{ currentEffortLabel }}</span>
      <svg class="ai-model-picker__chevron" width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
    <div v-if="open" class="ai-model-picker__popover" role="dialog" :aria-label="t.aiModelPicker">
      <label class="ai-model-picker__field">
        <span>{{ defaultCliTitle }}</span>
        <select
          :value="cli"
          @change="emit('update:cli', ($event.target as HTMLSelectElement).value as CliKind)"
        >
          <option v-for="c in availableClis" :key="c" :value="c">{{ cliLabel(c) }}</option>
        </select>
      </label>
      <label class="ai-model-picker__field">
        <span>{{ modelTitle }}</span>
        <select :value="modelSelectValue" @change="onModelChange">
          <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
      </label>
      <input
        v-if="isCustomModel"
        class="ai-model-picker__custom"
        type="text"
        :value="customModelInput"
        @input="onCustomModelInput"
        :placeholder="t.aiSettingsModelIdPlaceholder"
        :title="modelTitle"
      />
      <label v-if="effortOptions.length > 0" class="ai-model-picker__field">
        <span>{{ t.aiEffort }}</span>
        <select
          :value="effort"
          @change="emit('update:effort', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="e in effortOptions" :key="e.id" :value="e.id">{{ e.label }}</option>
        </select>
      </label>
    </div>
  </div>
</template>

<style scoped>
.ai-model-picker {
  position: relative;
  flex-shrink: 1;
  min-width: 0;
}
.ai-model-picker__trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 180px;
  padding: 4px 6px;
  background: transparent;
  color: var(--text-secondary);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.ai-model-picker__trigger:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}
.ai-model-picker__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-model-picker__effort {
  color: var(--text-muted);
  flex-shrink: 0;
}
.ai-model-picker__chevron {
  flex-shrink: 0;
  opacity: 0.7;
}
.ai-panel__status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.ai-panel__status-dot--ok { background: var(--success); box-shadow: 0 0 0 2px rgba(16,185,129,0.18); }
.ai-panel__status-dot--err { background: var(--danger); }
.ai-model-picker__popover {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  z-index: 12;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 220px;
  padding: 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 10px;
  box-shadow: var(--shadow-dropdown, var(--shadow-lg));
}
.ai-model-picker__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}
.ai-model-picker__field select,
.ai-model-picker__custom {
  background: var(--bg-input, var(--bg-secondary));
  color: var(--text-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  cursor: pointer;
}
.ai-model-picker__custom {
  cursor: text;
}
</style>
