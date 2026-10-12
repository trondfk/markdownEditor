import type { OpenFileClaim } from './useWindowManager';

interface FileOpeningOptions {
  getWindowLabel: () => string | Promise<string>;
  registerOpenFile: (filePath: string, windowLabel: string) => Promise<OpenFileClaim>;
  unregisterOpenFile: (filePath: string, documentId?: string) => Promise<void>;
  focusWindowWithFile: (filePath: string) => Promise<boolean>;
  findLocalFile: (filePath: string) => boolean;
  activateLocalFile: (filePath: string) => void | Promise<void>;
  bindDocumentIdentity: (filePath: string, documentId: string) => void;
  loadFile: (filePath: string) => Promise<boolean>;
}

/** Claim before loading. A same-window reservation is not permission to load again. */
export function useFileOpening(options: FileOpeningOptions) {
  const pendingLoads = new Map<string, Promise<void>>();

  const openFile = async (requestedPath: string): Promise<void> => {
    const windowLabel = await options.getWindowLabel();
    if (!windowLabel) throw new Error('Cannot open a file without a window identity');
    const claim = await options.registerOpenFile(requestedPath, windowLabel);
    const path = claim.file_path;

    if (!claim.acquired) {
      if (claim.window_label === windowLabel) {
        await pendingLoads.get(path);
        if (options.findLocalFile(path)) {
          await options.activateLocalFile(path);
          return;
        }
      }
      if (!await options.focusWindowWithFile(path)) {
        throw new Error('The existing file owner could not be activated');
      }
      return;
    }

    const loading = (async () => {
      try {
        if (options.findLocalFile(path)) {
          await options.activateLocalFile(path);
          options.bindDocumentIdentity(path, claim.document_id);
          return;
        }
        if (!await options.loadFile(path)) throw new Error('File loading failed');
        options.bindDocumentIdentity(path, claim.document_id);
      } catch (error) {
        // A UI callback can fail after the document was created. Keep ownership
        // while that document exists; release only an unused reservation.
        if (options.findLocalFile(path)) options.bindDocumentIdentity(path, claim.document_id);
        else await options.unregisterOpenFile(path, claim.document_id);
        throw error;
      }
    })();
    pendingLoads.set(path, loading);
    try {
      await loading;
    } finally {
      if (pendingLoads.get(path) === loading) pendingLoads.delete(path);
    }
  };

  return { openFile };
}
