import { describe, expect, it } from 'vitest';
import { classifyAiTool, extractToolFilePath, fileNameFromPath } from '../../utils/ai-tool-kind';

describe('classifyAiTool', () => {
  it('treats search and shell tools as activity', () => {
    expect(classifyAiTool('Read')).toBe('activity');
    expect(classifyAiTool('Grep')).toBe('activity');
    expect(classifyAiTool('Glob')).toBe('activity');
    expect(classifyAiTool('Bash')).toBe('activity');
    expect(classifyAiTool('Shell')).toBe('activity');
    expect(classifyAiTool('WebSearch')).toBe('activity');
    expect(classifyAiTool('read_file')).toBe('activity');
    expect(classifyAiTool('search_files')).toBe('activity');
  });

  it('treats write/edit tools as edits', () => {
    expect(classifyAiTool('Write')).toBe('edit');
    expect(classifyAiTool('Edit')).toBe('edit');
    expect(classifyAiTool('write_file')).toBe('edit');
    expect(classifyAiTool('edit_file')).toBe('edit');
    expect(classifyAiTool('apply_patch')).toBe('edit');
    expect(classifyAiTool('file_change')).toBe('edit');
  });

  it('returns other for unknown tools', () => {
    expect(classifyAiTool('TodoWrite')).toBe('other');
    expect(classifyAiTool(undefined)).toBe('other');
  });
});

describe('extractToolFilePath', () => {
  it('reads file_path from an object', () => {
    expect(extractToolFilePath({ file_path: 'E:/doc.md', limit: 12 })).toBe('E:/doc.md');
  });

  it('parses a JSON string of args', () => {
    expect(extractToolFilePath(JSON.stringify({ path: '/tmp/x.md' }))).toBe('/tmp/x.md');
  });

  it('returns null when no path is present', () => {
    expect(extractToolFilePath({ command: 'rg foo' })).toBeNull();
    expect(extractToolFilePath('')).toBeNull();
  });

  it('reads the path from an apply_patch header', () => {
    const patch = '*** Begin Patch\n*** Update File: docs/note.md\n@@\n-a\n+b\n*** End Patch';
    expect(extractToolFilePath({ input: patch })).toBe('docs/note.md');
    expect(extractToolFilePath(patch)).toBe('docs/note.md');
  });

  it('reads path from a nested changes array', () => {
    expect(extractToolFilePath({
      changes: [{ path: 'notes.md', diff: '@@\n-a\n+b\n' }],
    })).toBe('notes.md');
  });
});

describe('fileNameFromPath', () => {
  it('returns the last segment', () => {
    expect(fileNameFromPath('D:\\notes\\gantt.md')).toBe('gantt.md');
    expect(fileNameFromPath('/tmp/a/b.md')).toBe('b.md');
  });
});
