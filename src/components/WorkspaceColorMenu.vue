<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useI18n } from '../i18n';
import { FOLDER_COLORS } from '../utils/folder-colors';

/**
 * Swatch picker for a folder's icon colour, opened from the tree context menu.
 * Pure presentation: the parent owns persistence and decides which folder the
 * choice applies to.
 */
const { t } = useI18n();

const props = defineProps<{
  x: number;
  y: number;
  /** The folder's current colour, or null when it follows the theme. */
  current: string | null;
}>();

const emit = defineEmits<{
  (e: 'select', hex: string | null): void;
  (e: 'close'): void;
}>();

const menuRef = ref<HTMLDivElement | null>(null);
const adjustedX = ref(props.x);
const adjustedY = ref(props.y);

function pick(hex: string | null) {
  emit('select', hex);
  emit('close');
}

const onDocMouseDown = (e: MouseEvent) => {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) emit('close');
};
const onEscape = (e: KeyboardEvent) => {
  if (e.key === 'Escape') emit('close');
};

onMounted(() => {
  const menu = menuRef.value;
  if (menu) {
    const rect = menu.getBoundingClientRect();
    if (props.x + rect.width > window.innerWidth) adjustedX.value = window.innerWidth - rect.width - 8;
    if (props.y + rect.height > window.innerHeight) adjustedY.value = window.innerHeight - rect.height - 8;
  }
  // Deferred so the click that opened the menu doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onEscape);
  }, 0);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMouseDown);
  document.removeEventListener('keydown', onEscape);
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="menuRef"
      class="color-menu"
      :style="{ left: adjustedX + 'px', top: adjustedY + 'px' }"
    >
      <div class="color-swatches">
        <button
          v-for="color in FOLDER_COLORS"
          :key="color.id"
          class="color-swatch"
          :class="{ active: current === color.hex }"
          :style="{ background: color.hex }"
          :aria-label="t.folderColorLabel(color.id)"
          v-tooltip="t.folderColorLabel(color.id)"
          @click="pick(color.hex)"
        ></button>
      </div>
      <div class="color-menu-divider"></div>
      <button class="color-menu-item" @click="pick(null)">
        <span class="color-menu-check">{{ current === null ? '✓' : '' }}</span>
        {{ t.workspaceFolderColorDefault }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.color-menu {
  position: fixed;
  z-index: 10000;
  background: var(--dialog-bg);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 8px;
  box-shadow: var(--shadow-dropdown);
}

.color-swatches {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.color-swatch {
  width: 26px;
  height: 26px;
  border: 1px solid var(--border-primary);
  border-radius: 5px;
  cursor: pointer;
  padding: 0;
  transition: transform 0.1s;
}

.color-swatch:hover {
  transform: scale(1.1);
}

/* Outline rather than a border swap, so the swatch does not shift by a pixel
   when it becomes the active one. */
.color-swatch.active {
  outline: 2px solid var(--text-primary);
  outline-offset: 1px;
}

.color-menu-divider {
  height: 1px;
  background: var(--border-primary);
  margin: 8px 0 4px;
}

.color-menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 6px;
  font-size: 13px;
  text-align: left;
  border: none;
  background: none;
  color: var(--text-primary);
  border-radius: 4px;
  cursor: pointer;
}

.color-menu-item:hover {
  background: var(--hover-bg);
}

.color-menu-check {
  display: inline-block;
  width: 12px;
  color: var(--primary);
  flex-shrink: 0;
}
</style>
