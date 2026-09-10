import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AiPanelHeader from '../../components/ai/AiPanelHeader.vue';

function baseProps() {
  return {
    threads: [],
    activeThreadId: null,
    fullscreen: false,
    titleText: 'AI',
    fullscreenTitle: 'FS',
    exitFullscreenTitle: 'Exit FS',
    closeTitle: 'Close',
    newChatTitle: 'New chat',
  };
}

describe('AiPanelHeader', () => {
  it('does not render the model selects in the header', () => {
    const w = mount(AiPanelHeader, { props: baseProps() });
    expect(w.findAll('select')).toHaveLength(0);
    expect(w.find('.ai-panel__model-group').exists()).toBe(false);
  });

  it('emits minimize, toggleFullscreen, close on window buttons', async () => {
    const w = mount(AiPanelHeader, { props: baseProps() });
    const btns = w.findAll('.ai-panel__win-btn');
    await btns[0].trigger('click');
    await btns[1].trigger('click');
    await btns[2].trigger('click');
    expect(w.emitted('minimize')).toBeTruthy();
    expect(w.emitted('toggleFullscreen')).toBeTruthy();
    expect(w.emitted('close')).toBeTruthy();
  });

  it('emits revert and newChat on action buttons', async () => {
    const w = mount(AiPanelHeader, { props: baseProps() });
    const actions = w.findAll('.ai-panel__actions .ai-panel__icon-btn');
    await actions[0].trigger('click');
    await actions[actions.length - 1].trigger('click');
    expect(w.emitted('revert')).toBeTruthy();
    expect(w.emitted('newChat')).toBeTruthy();
  });
});
