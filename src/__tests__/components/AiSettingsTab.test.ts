// ABOUTME: Smoke-test that the AI settings form renders its main controls.
// ABOUTME: Catches a blank pane if the tab component fails to mount.
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));

import AiSettingsTab from '../../components/ai/AiSettingsTab.vue';

describe('AiSettingsTab', () => {
  it('shows the enable toggle and provider headings', () => {
    const w = mount(AiSettingsTab);
    expect(w.find('.ai-settings').exists()).toBe(true);
    expect(w.text()).toContain('Enable AI integration');
    expect(w.text()).toContain('Claude');
    expect(w.text()).toContain('Codex');
    expect(w.text()).toContain('Ollama');
  });
});
