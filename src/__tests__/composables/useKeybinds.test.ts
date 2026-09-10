import { describe, it, expect, beforeEach } from 'vitest';
import { chord } from '../../data/keybindActions';
import { useKeybinds } from '../../composables/useKeybinds';

describe('useKeybinds', () => {
  beforeEach(() => {
    localStorage.removeItem('mermark-keybinds');
    const { resetToDefaults } = useKeybinds();
    resetToDefaults();
  });

  it('starts with default save binding', () => {
    const { bindingFor } = useKeybinds();
    expect(bindingFor('save-file')).toEqual(chord('s', { ctrl: true }));
  });

  it('assigns an unbound writing tool and rejects conflicts', () => {
    const { setBinding, bindingFor } = useKeybinds();
    expect(setBinding('mermaid', chord('m', { ctrl: true }))).toBeNull();
    expect(bindingFor('mermaid')).toEqual(chord('m', { ctrl: true }));
    expect(setBinding('footnote', chord('m', { ctrl: true }))).toBe('mermaid');
    expect(bindingFor('footnote')).toBeNull();
  });

  it('clears a binding', () => {
    const { setBinding, bindingFor } = useKeybinds();
    setBinding('bold', null);
    expect(bindingFor('bold')).toBeNull();
  });
});
