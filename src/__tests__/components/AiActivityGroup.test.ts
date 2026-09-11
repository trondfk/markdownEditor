import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AiActivityGroup from '../../components/ai/AiActivityGroup.vue';
import AiChangeCard from '../../components/ai/AiChangeCard.vue';

describe('AiActivityGroup', () => {
  it('summarises search and shell without showing the raw command by default', () => {
    const w = mount(AiActivityGroup, {
      props: {
        messages: [
          { role: 'tool', tool: 'Grep', text: '{"pattern":"Gantt"}', done: true },
          { role: 'tool', tool: 'Shell', text: '{"command":"rg Gantt"}', done: true },
        ],
      },
    });
    expect(w.text()).toContain('Searched files');
    expect(w.text()).toContain('Ran 1 command');
    expect(w.text()).not.toContain('rg Gantt');
  });
});

describe('AiChangeCard', () => {
  it('shows keep and undo for a pending Write', async () => {
    const w = mount(AiChangeCard, {
      props: {
        message: {
          role: 'tool',
          tool: 'Write',
          text: JSON.stringify({ file_path: '/tmp/notes.md' }),
          changeStatus: 'pending',
          done: true,
        },
        index: 3,
        isActiveDoc: true,
      },
    });
    expect(w.text()).toContain('notes.md');
    await w.get('.ai-change__btn--keep').trigger('click');
    expect(w.emitted('keep')?.[0]).toEqual([3]);
  });

  it('renders an inline hunk with plus and minus counts', () => {
    const w = mount(AiChangeCard, {
      props: {
        message: {
          role: 'tool',
          tool: 'Edit',
          text: JSON.stringify({
            file_path: '/tmp/notes.md',
            old_string: 'alpha',
            new_string: 'beta',
          }),
          changeStatus: 'pending',
          done: true,
        },
        index: 1,
        isActiveDoc: true,
      },
    });
    expect(w.text()).toContain('+1');
    expect(w.text()).toContain('-1');
    expect(w.text()).toContain('alpha');
    expect(w.text()).toContain('beta');
  });
});
