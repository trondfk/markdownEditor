import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';

import AiMessage from '../../components/ai/AiMessage.vue';
import type { AiMessage as AiMessageType } from '../../composables/useAi';

function compaction(overrides: Partial<AiMessageType> = {}) {
  const message: AiMessageType = {
    role: 'compaction',
    text: 'Goal: fix the save path.\nNext: run the suite.',
    compactedCount: 12,
    done: true,
    ...overrides,
  };
  return mount(AiMessage, { props: { message, hasFence: false } });
}

describe('AiMessage compaction marker', () => {
  it('renders as a collapsed marker naming how many turns it replaced', () => {
    const w = compaction();
    const details = w.find('details.ai-msg--compaction');
    expect(details.exists()).toBe(true);
    expect(details.attributes('open')).toBeUndefined();
    expect(w.find('.ai-msg__compaction-label').text()).toContain('12');
  });

  it('keeps the summary in the DOM so expanding reveals it', () => {
    const w = compaction();
    expect(w.find('.ai-msg__compaction-summary').text()).toContain('Goal: fix the save path.');
  });

  it('does not render as a chat bubble', () => {
    const w = compaction();
    expect(w.find('.ai-msg--assistant').exists()).toBe(false);
    expect(w.find('.ai-msg--user').exists()).toBe(false);
  });

  it('singularises the count for a marker covering one message', () => {
    expect(compaction({ compactedCount: 1 }).find('.ai-msg__compaction-label').text())
      .toMatch(/1 earlier message$/);
  });
});
