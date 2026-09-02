import { describe, it, expect } from 'vitest';
import {
  FOLDER_COLORS,
  normalizeFolderColor,
  sanitizeFolderColors,
  remapFolderColors,
} from '../../utils/folder-colors';

const RED = FOLDER_COLORS[0].hex;
const BLUE = FOLDER_COLORS.find(c => c.id === 'blue')!.hex;

describe('the palette', () => {
  it('has unique ids and unique colours', () => {
    expect(new Set(FOLDER_COLORS.map(c => c.id)).size).toBe(FOLDER_COLORS.length);
    expect(new Set(FOLDER_COLORS.map(c => c.hex)).size).toBe(FOLDER_COLORS.length);
  });

  it('stores every colour in the canonical lowercase hex form', () => {
    for (const color of FOLDER_COLORS) {
      expect(color.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('normalizeFolderColor', () => {
  it('accepts a colour from the palette', () => {
    expect(normalizeFolderColor(RED)).toBe(RED);
  });

  it('accepts it regardless of case or padding', () => {
    expect(normalizeFolderColor(`  ${RED.toUpperCase()}  `)).toBe(RED);
  });

  // The palette is the allow-list: settings are hand-editable JSON and the
  // value ends up in an inline style.
  it('rejects a colour that is not in the palette', () => {
    expect(normalizeFolderColor('#123456')).toBeNull();
    expect(normalizeFolderColor('red')).toBeNull();
    expect(normalizeFolderColor('rgb(255, 0, 0)')).toBeNull();
  });

  it('rejects anything that is not a colour at all', () => {
    expect(normalizeFolderColor('')).toBeNull();
    expect(normalizeFolderColor('   ')).toBeNull();
    expect(normalizeFolderColor(null)).toBeNull();
    expect(normalizeFolderColor(undefined)).toBeNull();
    expect(normalizeFolderColor('url(evil.png)')).toBeNull();
  });
});

describe('sanitizeFolderColors', () => {
  it('keeps the valid entries and drops the rest', () => {
    const result = sanitizeFolderColors({
      'D:/notes/keep': RED,
      'D:/notes/drop': 'chartreuse',
    });

    expect(result).toEqual({ 'D:/notes/keep': RED });
  });

  it('survives a missing or empty map', () => {
    expect(sanitizeFolderColors(null)).toEqual({});
    expect(sanitizeFolderColors(undefined)).toEqual({});
    expect(sanitizeFolderColors({})).toEqual({});
  });
});

describe('remapFolderColors', () => {
  it('moves the colour of the renamed folder', () => {
    const result = remapFolderColors({ 'D:/notes/Bat': RED }, 'D:/notes/Bat', 'D:/notes/Boat');

    expect(result).toEqual({ 'D:/notes/Boat': RED });
  });

  it('moves the colours of coloured folders underneath it', () => {
    const result = remapFolderColors(
      {
        'D:/notes/Web': RED,
        'D:/notes/Web/partner': BLUE,
      },
      'D:/notes/Web',
      'D:/notes/Frontend',
    );

    expect(result).toEqual({
      'D:/notes/Frontend': RED,
      'D:/notes/Frontend/partner': BLUE,
    });
  });

  it('leaves unrelated folders alone', () => {
    const result = remapFolderColors(
      { 'D:/notes/Other': BLUE },
      'D:/notes/Web',
      'D:/notes/Frontend',
    );

    expect(result).toEqual({ 'D:/notes/Other': BLUE });
  });

  // A folder named as a prefix of another must not drag its neighbour along.
  it('does not touch a sibling whose name merely starts the same', () => {
    const result = remapFolderColors(
      { 'D:/notes/Web utvikling': BLUE },
      'D:/notes/Web',
      'D:/notes/Frontend',
    );

    expect(result).toEqual({ 'D:/notes/Web utvikling': BLUE });
  });

  it('matches across separator styles, since tree paths and settings can differ', () => {
    const result = remapFolderColors(
      { 'D:\\notes\\Web\\partner': RED },
      'D:/notes/Web',
      'D:/notes/Frontend',
    );

    expect(result).toEqual({ 'D:/notes/Frontend\\partner': RED });
  });

  // Handing back the same object lets the caller skip a settings write, which
  // would otherwise fire on every rename in the tree.
  it('returns the original map untouched when nothing matched', () => {
    const colors = { 'D:/notes/Other': BLUE };

    expect(remapFolderColors(colors, 'D:/notes/Web', 'D:/notes/Frontend')).toBe(colors);
  });

  it('has nothing to do for an empty map', () => {
    expect(remapFolderColors({}, 'D:/a', 'D:/b')).toEqual({});
  });
});
