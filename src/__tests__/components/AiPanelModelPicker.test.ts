// ABOUTME: Tests for the compact AI model chip and its popover selects.
// ABOUTME: Selects stay unmounted until the chip is opened.

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AiPanelModelPicker from '../../components/ai/AiPanelModelPicker.vue';
import { CUSTOM_MODEL_SENTINEL } from '../../composables/useAiModels';
import type { CliKind } from '../../services/aiCommands';

function baseProps() {
  return {
    cli: 'claude' as CliKind,
    availableClis: ['claude', 'codex'] as CliKind[],
    model: 'claude-sonnet-4-6',
    modelOptions: [
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
      { id: CUSTOM_MODEL_SENTINEL, label: 'Custom…', custom: true },
    ],
    effort: 'medium',
    effortOptions: [{ id: 'medium', label: 'Medium' }, { id: 'low', label: 'Low' }],
    customModelInput: '',
    isCustomModel: false,
    cliConnected: true,
    cliAccount: 'demo@x.io',
    statusOkLabel: (a: string) => `OK ${a}`,
    statusAuthLabel: 'Auth',
    modelTitle: 'Model',
    defaultCliTitle: 'CLI',
  };
}

async function openPicker(w: ReturnType<typeof mount>) {
  await w.find('.ai-model-picker__trigger').trigger('click');
}

describe('AiPanelModelPicker', () => {
  it('shows the current model on the chip and hides the selects', () => {
    const w = mount(AiPanelModelPicker, { props: baseProps() });
    expect(w.find('.ai-model-picker__label').text()).toBe('Sonnet 4.6');
    expect(w.findAll('select')).toHaveLength(0);
  });

  it('shows OK status dot when connected', () => {
    const w = mount(AiPanelModelPicker, { props: baseProps() });
    expect(w.find('.ai-panel__status-dot--ok').exists()).toBe(true);
  });

  it('shows error status dot when not connected', () => {
    const w = mount(AiPanelModelPicker, { props: { ...baseProps(), cliConnected: false } });
    expect(w.find('.ai-panel__status-dot--err').exists()).toBe(true);
  });

  it('emits update:cli when CLI dropdown changes', async () => {
    const w = mount(AiPanelModelPicker, { props: baseProps() });
    await openPicker(w);
    const select = w.findAll('select')[0];
    await select.setValue('codex');
    expect(w.emitted('update:cli')?.[0]).toEqual(['codex']);
  });

  it('emits update:model on plain model option select', async () => {
    const w = mount(AiPanelModelPicker, { props: baseProps() });
    await openPicker(w);
    const modelSelect = w.findAll('select')[1];
    await modelSelect.setValue('claude-sonnet-4-6');
    expect(w.emitted('update:model')?.[0]).toEqual(['claude-sonnet-4-6']);
  });

  it('renders custom model input when isCustomModel=true and open', async () => {
    const w = mount(AiPanelModelPicker, {
      props: { ...baseProps(), isCustomModel: true, customModelInput: 'foo' },
    });
    expect(w.find('.ai-model-picker__custom').exists()).toBe(false);
    await openPicker(w);
    expect(w.find('.ai-model-picker__custom').exists()).toBe(true);
    expect((w.find('.ai-model-picker__custom').element as HTMLInputElement).value).toBe('foo');
  });
});
