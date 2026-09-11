// ABOUTME: Guards the AI settings tab so it actually mounts inside Settings.
// ABOUTME: A missing import once rendered an empty AI pane with no controls.
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('1.0.5'),
}));
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(async () => null),
}));
vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));

import SettingsModal from '../../components/SettingsModal.vue';

describe('SettingsModal AI tab', () => {
  it('renders the AI settings form when the AI tab is opened', async () => {
    const w = mount(SettingsModal);
    const aiTab = w.findAll('.settings-tab').find(tab => tab.text().includes('AI'));
    expect(aiTab).toBeTruthy();
    await aiTab!.trigger('click');
    await nextTick();
    expect(w.find('.ai-settings').exists()).toBe(true);
    expect(w.text()).toContain('Enable AI integration');
  });

  it('shows the interface size slider on the appearance tab', async () => {
    const w = mount(SettingsModal);
    const appearance = w.findAll('.settings-tab').find(tab => tab.text().includes('Appearance'));
    expect(appearance).toBeTruthy();
    await appearance!.trigger('click');
    await nextTick();
    expect(w.text()).toContain('Interface size');
    expect(w.find('input.setting-range').exists()).toBe(true);
  });
});
