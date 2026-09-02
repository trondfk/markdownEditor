<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue';

withDefaults(defineProps<{ ariaLabel?: string }>(), { ariaLabel: 'Resize' });

const emit = defineEmits<{
  resize: [clientX: number];
  resizeEnd: [];
}>();

const isDragging = ref(false);

function onMove(event: MouseEvent) {
  emit('resize', event.clientX);
}

function stop() {
  if (!isDragging.value) return;
  isDragging.value = false;
  document.removeEventListener('mousemove', onMove);
  document.removeEventListener('mouseup', stop);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  emit('resizeEnd');
}

function start(event: MouseEvent) {
  event.preventDefault();
  isDragging.value = true;
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', stop);
  // Held on <body> so the cursor survives the pointer leaving the 6px strip.
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

// A divider unmounted mid-drag (pane closed by a shortcut) would otherwise
// leave the move/up listeners and the body cursor behind.
onBeforeUnmount(stop);
</script>

<template>
  <div
    class="resize-divider"
    :class="{ dragging: isDragging }"
    role="separator"
    aria-orientation="vertical"
    :aria-label="ariaLabel"
    @mousedown="start"
  >
    <div class="resize-divider__handle"></div>
  </div>
</template>

<style scoped>
.resize-divider {
  position: relative;
  width: 6px;
  flex-shrink: 0;
  background: var(--divider-bg);
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
}

/* Widens the grab target to ~16px without shifting the layout, so the divider
   is forgiving to hit while still reading as a thin seam. */
.resize-divider::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -5px;
  right: -5px;
}

.resize-divider:hover,
.resize-divider.dragging {
  background: var(--divider-hover);
}

.resize-divider__handle {
  width: 2px;
  height: 40px;
  border-radius: 1px;
  background: var(--divider-handle);
  transition: background 0.15s ease;
}

.resize-divider:hover .resize-divider__handle,
.resize-divider.dragging .resize-divider__handle {
  background: var(--divider-handle-hover);
}

@media print {
  .resize-divider {
    display: none !important;
  }
}
</style>
