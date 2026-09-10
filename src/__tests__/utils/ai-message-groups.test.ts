import { describe, expect, it } from 'vitest';
import type { AiMessage } from '../../composables/useAi';
import { groupAiMessages, summarizeActivity } from '../../utils/ai-message-groups';

function tool(tool: string, text = '{}'): AiMessage {
  return { role: 'tool', tool, text, done: true };
}

describe('groupAiMessages', () => {
  it('collapses consecutive search/shell tools into one activity group', () => {
    const messages: AiMessage[] = [
      { role: 'user', text: 'where is gantt', done: true },
      tool('Grep', '{"pattern":"Gantt"}'),
      tool('Shell', '{"command":"rg Gantt"}'),
      { role: 'assistant', text: 'found it', done: true },
    ];
    const groups = groupAiMessages(messages);
    expect(groups.map(g => g.type)).toEqual(['single', 'activity', 'single']);
    if (groups[1].type !== 'activity') throw new Error('expected activity');
    expect(groups[1].messages).toHaveLength(2);
  });

  it('renders Write as a change card', () => {
    const messages: AiMessage[] = [
      tool('Write', '{"file_path":"/tmp/a.md"}'),
    ];
    const groups = groupAiMessages(messages);
    expect(groups[0]).toMatchObject({ type: 'change' });
  });
});

describe('summarizeActivity', () => {
  it('counts searches vs shell', () => {
    expect(summarizeActivity([
      tool('Grep'),
      tool('Read'),
      tool('Shell'),
    ])).toEqual({ searches: 2, commands: 1, other: 0 });
  });
});
