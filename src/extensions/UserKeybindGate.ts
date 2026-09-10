// ABOUTME: Swallows StarterKit default shortcuts so App.vue keybinds own them.
// ABOUTME: Remapping Ctrl+B would otherwise still toggle bold via TipTap.

import { Extension } from '@tiptap/core';

/** Chords StarterKit / History still bind after we take over dispatch. */
export const TIP_TAP_SWALLOWED_CHORDS = ['Mod-b', 'Mod-i', 'Mod-Shift-s', 'Mod-e', 'Mod-z', 'Mod-y'] as const;

export const UserKeybindGate = Extension.create({
  name: 'userKeybindGate',
  // After StarterKit so these no-ops win over Bold/Italic/Undo.
  priority: 1000,
  addKeyboardShortcuts() {
    const swallow = () => true;
    return Object.fromEntries(TIP_TAP_SWALLOWED_CHORDS.map(k => [k, swallow]));
  },
});
