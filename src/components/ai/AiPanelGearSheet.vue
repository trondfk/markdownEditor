<!-- ABOUTME: Gear sheet for access map, instructions, snapshots, and report-a-problem.
     ABOUTME: Keeps the chat composer as input-only. -->
<script setup lang="ts">
import AiAccessMapEditor from './AiAccessMapEditor.vue';
import AiSnapshotList from './AiSnapshotList.vue';
import { useI18n } from '../../i18n';
import { useSettings, CUSTOM_INSTRUCTIONS_MAX } from '../../composables/useSettings';
import type { AccessMap } from '../../services/aiCommands';

const { t } = useI18n();
const {
  settings,
  setAiCustomInstructions,
  setAiUseProjectInstructions,
  setAiWorkspaceWrite,
} = useSettings();

defineProps<{
  open: boolean;
  accessMapTitle: string;
  docPath: string;
  accessMap: AccessMap | null;
  workspaceRoot?: string;
}>();

const emit = defineEmits<{
  close: [];
  'update:accessMap': [value: AccessMap];
  snapshotRestored: [content: string];
  reportFeedback: [];
}>();
</script>

<template>
  <div v-if="open" class="ai-gear">
    <div class="ai-gear__backdrop" @click="emit('close')" />
    <div class="ai-gear__sheet" role="dialog" :aria-label="t.aiComposerSettings">
      <header class="ai-gear__head">
        <strong>{{ t.aiComposerSettings }}</strong>
        <button type="button" class="ai-gear__close" @click="emit('close')">{{ t.close }}</button>
      </header>
      <div class="ai-gear__body">
        <section>
          <h4>{{ t.aiCustomInstructions }}</h4>
          <textarea
            class="ai-gear__instructions"
            rows="5"
            :maxlength="CUSTOM_INSTRUCTIONS_MAX"
            :value="settings.ai.customInstructions"
            @change="setAiCustomInstructions(($event.target as HTMLTextAreaElement).value)"
          />
          <p class="ai-gear__hint">{{ t.aiCustomInstructionsHint }}</p>
        </section>
        <label v-if="workspaceRoot" class="ai-gear__check">
          <input
            type="checkbox"
            :checked="settings.ai.useProjectInstructions"
            @change="setAiUseProjectInstructions(($event.target as HTMLInputElement).checked)"
          />
          <span>{{ t.aiProjectInstructions }}</span>
        </label>
        <label v-if="workspaceRoot" class="ai-gear__check">
          <input
            type="checkbox"
            :checked="settings.ai.workspaceWrite"
            @change="setAiWorkspaceWrite(($event.target as HTMLInputElement).checked)"
          />
          <span>{{ t.aiWorkspaceWrite }}</span>
        </label>
        <p v-if="workspaceRoot" class="ai-gear__hint">{{ t.aiWorkspaceWriteHint }}</p>
        <section>
          <h4>{{ accessMapTitle }}</h4>
          <AiAccessMapEditor
            v-if="accessMap"
            :model-value="accessMap"
            @update:model-value="(v) => emit('update:accessMap', v)"
          />
        </section>
        <AiSnapshotList :doc-path="docPath" @restored="(c) => emit('snapshotRestored', c)" />
        <button type="button" class="ai-gear__report" @click="emit('reportFeedback')">{{ t.reportFeedback }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai-gear {
  position: absolute;
  inset: 0;
  z-index: 8;
}
.ai-gear__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
}
.ai-gear__sheet {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: min(360px, 100%);
  background: var(--bg-primary);
  border-left: 1px solid var(--border-primary);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ai-gear__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-primary);
}
.ai-gear__close {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
}
.ai-gear__body {
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ai-gear__body h4 {
  margin: 0 0 8px;
  font-size: 12px;
}
.ai-gear__report {
  align-self: flex-start;
  border: 1px solid var(--border-primary);
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
}
.ai-gear__instructions {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 12px;
  background: var(--bg-input, var(--bg-secondary));
  color: var(--text-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  padding: 6px 8px;
}
.ai-gear__hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-muted);
}
.ai-gear__check {
  display: flex;
  gap: 8px;
  font-size: 12px;
  align-items: flex-start;
}
</style>
