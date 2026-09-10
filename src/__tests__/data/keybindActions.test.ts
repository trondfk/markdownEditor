import { describe, expect, it } from 'vitest';
import {
  chord,
  chordsEqual,
  defaultKeybindMap,
  formatChord,
  KEYBIND_ACTIONS,
  matchActionId,
} from '../../data/keybindActions';

function keyEvent(key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
  } as KeyboardEvent;
}

describe('keybindActions', () => {
  it('has unique action ids', () => {
    const ids = KEYBIND_ACTIONS.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('matches Ctrl+S to save', () => {
    const map = defaultKeybindMap();
    expect(matchActionId(keyEvent('s', { ctrl: true }), map)).toBe('save-file');
    expect(matchActionId(keyEvent('s', { meta: true }), map)).toBe('save-file');
    expect(matchActionId(keyEvent('s', { ctrl: true, shift: true }), map)).toBe('save-file-as');
  });

  it('does not match unbound writing tools until assigned', () => {
    const map = defaultKeybindMap();
    expect(map.mermaid).toBeNull();
    expect(matchActionId(keyEvent('m', { ctrl: true }), map)).toBeNull();
    map.mermaid = chord('m', { ctrl: true });
    expect(matchActionId(keyEvent('m', { ctrl: true }), map)).toBe('mermaid');
  });

  it('formats chords', () => {
    expect(formatChord(chord('b', { ctrl: true }))).toBe('Ctrl+B');
    expect(formatChord(null, 'Ingen')).toBe('Ingen');
  });

  it('treats equal chords as equal', () => {
    expect(chordsEqual(chord('b', { ctrl: true }), chord('b', { ctrl: true }))).toBe(true);
    expect(chordsEqual(chord('b', { ctrl: true }), chord('b', { ctrl: true, shift: true }))).toBe(false);
  });
});
