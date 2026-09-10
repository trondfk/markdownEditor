// ABOUTME: Checks that the keybind gate lists the StarterKit chords it swallows.
// ABOUTME: App.vue remaps those chords; TipTap must not keep the originals.
import { describe, expect, it } from 'vitest';
import { TIP_TAP_SWALLOWED_CHORDS, UserKeybindGate } from '../../extensions/UserKeybindGate';

describe('UserKeybindGate', () => {
  it('owns bold, italic and undo/redo so App.vue can remap them', () => {
    expect(UserKeybindGate.name).toBe('userKeybindGate');
    expect([...TIP_TAP_SWALLOWED_CHORDS]).toEqual([
      'Mod-b', 'Mod-i', 'Mod-Shift-s', 'Mod-e', 'Mod-z', 'Mod-y',
    ]);
  });
});
