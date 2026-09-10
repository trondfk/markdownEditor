import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AiPanelPinList from '../../components/ai/AiPanelPinList.vue';
import type { PinnedItem } from '../../composables/useAiPinnedSelections';

const pins: PinnedItem[] = [
  { id: 'a', text: 'alpha', createdAt: '2026-05-05T00:00:00.000Z' },
  { id: 'b', text: 'beta', createdAt: '2026-05-05T00:00:01.000Z' },
];

const preview = (s: string, max = 100) => s.length > max ? s.slice(0, max) + '…' : s;

function baseProps() {
  return {
    pins,
    includePinned: true,
    showLive: false,
    liveText: null as string | null,
    preview,
  };
}

describe('AiPanelPinList', () => {
  it('renders one row per pin and shows count label', () => {
    const w = mount(AiPanelPinList, { props: baseProps() });
    expect(w.findAll('.ai-panel__pin-item')).toHaveLength(2);
    expect(w.text()).toContain('2 pinned');
  });

  it('does not render when no pins and no live', () => {
    const w = mount(AiPanelPinList, { props: { ...baseProps(), pins: [] } });
    expect(w.find('.ai-panel__pinned').exists()).toBe(false);
  });

  it('emits remove with pin id on × click', async () => {
    const w = mount(AiPanelPinList, { props: baseProps() });
    await w.findAll('.ai-panel__pin-rm')[0].trigger('click');
    expect(w.emitted('remove')?.[0]).toEqual(['a']);
  });

  it('emits clearAll on Clear button', async () => {
    const w = mount(AiPanelPinList, { props: baseProps() });
    await w.find('.ai-panel__pinned-action--clear').trigger('click');
    expect(w.emitted('clearAll')).toBeTruthy();
  });

  it('emits update:includePinned on toggle change', async () => {
    const w = mount(AiPanelPinList, { props: baseProps() });
    const cb = w.find('input[type="checkbox"]');
    (cb.element as HTMLInputElement).checked = false;
    await cb.trigger('change');
    expect(w.emitted('update:includePinned')?.[0]).toEqual([false]);
  });

  it('shows live block when showLive=true', () => {
    const w = mount(AiPanelPinList, { props: { ...baseProps(), showLive: true, liveText: 'live-bit' } });
    expect(w.find('.ai-panel__pin-live').exists()).toBe(true);
    expect(w.text()).toContain('live-bit');
  });

  it('emits pin event on + Pin button click', async () => {
    const w = mount(AiPanelPinList, { props: { ...baseProps(), pins: [], showLive: true, liveText: 'x' } });
    await w.find('.ai-panel__pinned-action').trigger('click');
    expect(w.emitted('pin')).toBeTruthy();
  });

  it('keeps a short live selection on one line without Show more', () => {
    const w = mount(AiPanelPinList, {
      props: { ...baseProps(), pins: [], showLive: true, liveText: 'a short bit' },
    });
    expect(w.find('.ai-panel__pin-more').exists()).toBe(false);
    expect(w.find('.ai-panel__pin-live-text--open').exists()).toBe(false);
  });

  it('offers Show more for a long live selection and expands on click', async () => {
    const liveText = 'word '.repeat(40).trim();
    const w = mount(AiPanelPinList, {
      props: { ...baseProps(), pins: [], showLive: true, liveText },
    });
    const more = w.find('.ai-panel__pin-more');
    expect(more.exists()).toBe(true);
    expect(more.text()).toContain('Show more');
    await more.trigger('click');
    expect(w.find('.ai-panel__pin-live--open').exists()).toBe(true);
    expect(w.find('.ai-panel__pin-live-text--open').exists()).toBe(true);
    expect(w.find('.ai-panel__pin-more').text()).toContain('Show less');
    expect(w.find('.ai-panel__pin-live-text').text()).toBe(liveText);
  });

  it('offers Show more when the live selection has several lines', () => {
    const w = mount(AiPanelPinList, {
      props: { ...baseProps(), pins: [], showLive: true, liveText: 'line one\nline two' },
    });
    expect(w.find('.ai-panel__pin-more').exists()).toBe(true);
  });
});
