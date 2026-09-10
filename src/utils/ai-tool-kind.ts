// ABOUTME: Classifies AI tool calls as quiet activity vs file edits.
// ABOUTME: Lets the chat hide shell/grep noise and show Cursor-like change cards.

export type AiToolKind = 'activity' | 'edit' | 'other';

const ACTIVITY_TOOLS = new Set([
  'read',
  'glob',
  'grep',
  'bash',
  'shell',
  'websearch',
  'webfetch',
  'webbrowser',
  'list_dir',
  'read_file',
  'search_files',
  'ls',
  'find',
]);

const EDIT_TOOLS = new Set([
  'write',
  'edit',
  'write_file',
  'edit_file',
  'applypatch',
  'apply_patch',
  'strreplace',
  'str_replace',
]);

function normalizeToolName(tool: string): string {
  return tool.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function classifyAiTool(tool: string | undefined): AiToolKind {
  if (!tool) return 'other';
  const name = normalizeToolName(tool);
  if (ACTIVITY_TOOLS.has(name)) return 'activity';
  if (EDIT_TOOLS.has(name)) return 'edit';
  return 'other';
}

const PATH_KEYS = ['file_path', 'path', 'target_file', 'file', 'filename'];

/** Pull a file path out of a tool-args object or JSON string. */
export function extractToolFilePath(args: unknown): string | null {
  if (args == null) return null;
  let obj: unknown = args;
  if (typeof args === 'string') {
    const trimmed = args.trim();
    if (!trimmed) return null;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  for (const key of PATH_KEYS) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export function fileNameFromPath(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(i + 1) : path;
}
