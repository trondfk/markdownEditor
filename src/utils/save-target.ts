import { atomicWriteTextFile, type AtomicWriteOptions } from './atomic-write';
import { canCommitSave, completeSave, recordSaveCommit, wasSavePublished, type SaveState } from './save-state';

export interface SaveTargetLease {
  filePath: string;
  created: boolean;
  canWrite?: () => boolean;
  finish: (committed: boolean, publish?: boolean) => Promise<boolean>;
}

export type SaveTargetReserver = (state: SaveState, requestedPath: string) => Promise<SaveTargetLease | null>;

/** Keep ownership until disk replacement and binding publication are resolved. */
export async function writeReservedSave(state: SaveState, markdown: string, lease: SaveTargetLease,
  options: AtomicWriteOptions = {}): Promise<boolean> {
  let committed = false;
  try {
    await atomicWriteTextFile(lease.filePath, markdown, {
      canWrite: () => canCommitSave(state) && (lease.canWrite?.() ?? true) && (options.canWrite?.() ?? true),
      onCommitted: () => {
        committed = true;
        recordSaveCommit(state, lease.filePath, markdown);
        options.onCommitted?.();
      },
    });
    if (lease.canWrite?.() !== false) completeSave(state, lease.filePath, markdown);
    const published = wasSavePublished(state);
    // The old registration is released only after the frontend binding is updated.
    if (!await lease.finish(true, published)) return false;
    return wasSavePublished(state) && !state.tab.hasChanges;
  } finally {
    // A lost commit acknowledgement must not release a possibly committed target.
    if (!committed) await lease.finish(false);
  }
}
