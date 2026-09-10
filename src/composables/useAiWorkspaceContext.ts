// ABOUTME: Folds workspace roots into the AI access map for a send.
// ABOUTME: Reads are always granted; writes stay on the main file unless opted in.

import type { AccessMap } from '../services/aiCommands';
import type { AssistantMode } from './useSettings';
import { accessMapForMode } from './useAiPreamble';

/**
 * Returns a copy of `accessMap` with the workspace root added to `readPaths`
 * (deduplicated). When `workspaceRoot` is empty, the input is returned
 * unchanged. `writePaths` is never modified here.
 */
export function withWorkspaceReadAccess(
  accessMap: AccessMap | null,
  workspaceRoot: string,
): AccessMap | null {
  if (!accessMap) return accessMap;
  if (!workspaceRoot) return accessMap;
  if (accessMap.readPaths.includes(workspaceRoot)) return accessMap;
  return {
    ...accessMap,
    readPaths: [...accessMap.readPaths, workspaceRoot],
  };
}

/**
 * Adds the workspace root to writePaths when the user opted in. First
 * write path stays the active document so the backend still treats it as main.
 */
export function withWorkspaceWriteAccess(
  accessMap: AccessMap | null,
  workspaceRoot: string,
  enabled: boolean,
): AccessMap | null {
  if (!accessMap || !enabled || !workspaceRoot) return accessMap;
  if (accessMap.writePaths.includes(workspaceRoot)) return accessMap;
  return {
    ...accessMap,
    writePaths: [...accessMap.writePaths, workspaceRoot],
  };
}

/** Read access, optional workspace writes, then Ask/Plan write gating. */
export function accessMapForSend(
  accessMap: AccessMap | null,
  workspaceRoot: string,
  mode: AssistantMode,
  workspaceWrite: boolean,
): AccessMap | null {
  const withRead = withWorkspaceReadAccess(accessMap, workspaceRoot);
  const allowWsWrite = workspaceWrite && mode === 'agent';
  const withWrite = withWorkspaceWriteAccess(withRead, workspaceRoot, allowWsWrite);
  return accessMapForMode(withWrite, mode);
}
