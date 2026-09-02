import { describe, it, expect } from 'vitest';
import type { Translations } from '../../i18n/index';
import { useI18n } from '../../i18n/index';
import en from '../../i18n/locales/en';
import no from '../../i18n/locales/no';

const locales: Record<string, Translations> = { en, no };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

function getStringKeys(obj: Translations): string[] {
  return Object.keys(obj).filter(key => typeof (obj as AnyRecord)[key] === 'string');
}

function getFunctionKeys(obj: Translations): string[] {
  return Object.keys(obj).filter(key => typeof (obj as AnyRecord)[key] === 'function');
}

describe('i18n translations', () => {
  it('all locales should have the same string keys as English', () => {
    const enKeys = getStringKeys(en).sort();
    for (const [name, locale] of Object.entries(locales)) {
      if (name === 'en') continue;
      const keys = getStringKeys(locale).sort();
      expect(keys, `${name} is missing or has extra string keys vs en`).toEqual(enKeys);
    }
  });

  it('all locales should have the same function keys as English', () => {
    const enKeys = getFunctionKeys(en).sort();
    for (const [name, locale] of Object.entries(locales)) {
      if (name === 'en') continue;
      const keys = getFunctionKeys(locale).sort();
      expect(keys, `${name} is missing or has extra function keys vs en`).toEqual(enKeys);
    }
  });

  it('no string values should be empty', () => {
    for (const [name, locale] of Object.entries(locales)) {
      for (const key of getStringKeys(locale)) {
        const value = (locale as AnyRecord)[key] as string;
        expect(value.length, `${name}.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('function translations should return strings', () => {
    for (const [name, locale] of Object.entries(locales)) {
      for (const key of getFunctionKeys(locale)) {
        const fn = (locale as AnyRecord)[key] as (...args: unknown[]) => string;
        const result = key === 'headingLevel' ? fn(1) : fn('test.md');
        expect(typeof result, `${name}.${key}() should return string`).toBe('string');
        expect(result.length, `${name}.${key}() returned empty string`).toBeGreaterThan(0);
      }
    }
  });

  it('no should be translated rather than copied from English', () => {
    // Brand names, proper nouns, format samples and single-letter format
    // buttons are identical by design.
    const skipKeys = new Set([
      'dedication',
      'appName', 'exportPdf', 'exportDocx', 'bold', 'italic', 'strikethrough', 'mermaid',
      'printScale', 'zoom', 'diffView', 'tokens', 'aiTabLabel', 'aiCliStatusClaude',
      'aiCliStatusCodex', 'aiOllamaBaseUrlPlaceholder', 'aiOpenaiBaseUrlPlaceholder',
      'aiFirstRunOk', 'aiSendButton', 'aiPinSendLabel', 'aiSettingsCliHeading',
      'themeVariantMinimal', 'aiAssistMermaidButton', 'pdfPageNumberFormatN',
      'pdfPageNumberFormatNOfTotal', 'marpPause', 'editor',
    ]);
    const keysToCheck = getStringKeys(en).filter(k => !skipKeys.has(k));
    const untranslated = keysToCheck.filter(
      key => (no as AnyRecord)[key] === (en as AnyRecord)[key],
    );
    expect(untranslated, 'no keys still hold the English string').toEqual([]);
  });

  it('every locale with translations is selectable and labelled', () => {
    const { availableLocales, localeLabels } = useI18n();
    expect([...availableLocales].sort()).toEqual(Object.keys(locales).sort());
    for (const loc of availableLocales) {
      expect(localeLabels[loc], `${loc} has no display label`).toBeTruthy();
    }
  });
});
