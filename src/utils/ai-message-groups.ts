// ABOUTME: Groups consecutive AI tool rows for a quieter chat transcript.
// ABOUTME: Activity tools collapse; Write/Edit become file-change cards.

import type { AiMessage } from '../composables/useAi';
import { classifyAiTool } from './ai-tool-kind';

export type AiMessageGroup =
  | { type: 'single'; index: number; message: AiMessage }
  | { type: 'activity'; start: number; messages: AiMessage[] }
  | { type: 'change'; index: number; message: AiMessage };

export function groupAiMessages(messages: AiMessage[]): AiMessageGroup[] {
  const groups: AiMessageGroup[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role === 'tool' && classifyAiTool(m.tool) === 'activity') {
      const batch: AiMessage[] = [m];
      const start = i;
      i += 1;
      while (i < messages.length
        && messages[i].role === 'tool'
        && classifyAiTool(messages[i].tool) === 'activity') {
        batch.push(messages[i]);
        i += 1;
      }
      groups.push({ type: 'activity', start, messages: batch });
      continue;
    }
    if (m.role === 'tool' && classifyAiTool(m.tool) === 'edit') {
      groups.push({ type: 'change', index: i, message: m });
      i += 1;
      continue;
    }
    groups.push({ type: 'single', index: i, message: m });
    i += 1;
  }
  return groups;
}

export function summarizeActivity(messages: AiMessage[]): { searches: number; commands: number; other: number } {
  let searches = 0;
  let commands = 0;
  let other = 0;
  for (const m of messages) {
    const name = (m.tool ?? '').toLowerCase();
    if (name.includes('grep') || name.includes('glob') || name === 'read' || name === 'read_file' || name.includes('search')) {
      searches += 1;
    } else if (name.includes('bash') || name.includes('shell')) {
      commands += 1;
    } else {
      other += 1;
    }
  }
  return { searches, commands, other };
}
