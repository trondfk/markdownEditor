// ABOUTME: Finds local markdown image paths in the active note.
// ABOUTME: Used to attach those files so Claude/Codex can read text in pictures.

import { MAX_IMAGE_BYTES } from '../composables/useAiPendingImages';

export interface DocImageRef {
  alt: string;
  src: string;
  absolutePath: string;
}

const IMAGE_RE = /!\[([^\]]*)\]\(\s*([^)\s]+)((?:\s+"[^"]*")?)\s*\)/g;

export const MAX_DOC_IMAGES_PER_TURN = 4;

/**
 * Resolves a relative image path to an absolute file path.
 * Same rules as image-resolver: Windows drive letters, `..` segments.
 */
export function resolveImagePath(src: string, baseDir: string): string {
  if (/^[a-zA-Z]:/.test(src) || src.startsWith('/')) {
    return src;
  }

  let absolutePath = `${baseDir}/${src}`.replace(/\\/g, '/');
  const parts = absolutePath.split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      normalized.pop();
    } else if (part !== '.' && part !== '') {
      normalized.push(part);
    }
  }
  absolutePath = normalized.join('/');
  if (/^[a-zA-Z]\//.test(absolutePath)) {
    absolutePath = absolutePath.replace(/^([a-zA-Z])\//, '$1:/');
  }
  return absolutePath;
}

export function isRemoteOrDataImage(src: string): boolean {
  return /^(data:|blob:|https?:)/i.test(src);
}

/** Unique local image refs in markdown, in document order. */
export function extractLocalImageRefs(markdown: string, baseDir?: string): DocImageRef[] {
  const matches = [...markdown.matchAll(IMAGE_RE)];
  const seen = new Set<string>();
  const out: DocImageRef[] = [];
  for (const m of matches) {
    const alt = m[1] ?? '';
    const src = m[2];
    if (!src || isRemoteOrDataImage(src)) continue;
    const isAbsolute = /^[a-zA-Z]:/.test(src) || src.startsWith('/');
    if (!isAbsolute && !baseDir) continue;
    const absolutePath = isAbsolute ? src : resolveImagePath(src, baseDir!);
    if (seen.has(absolutePath)) continue;
    seen.add(absolutePath);
    out.push({ alt, src, absolutePath });
  }
  return out;
}

export function capDocImages<T>(images: T[], max = MAX_DOC_IMAGES_PER_TURN): T[] {
  return images.slice(0, max);
}

export function isWithinImageBudget(bytes: number, max = MAX_IMAGE_BYTES): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= max;
}

export { MAX_IMAGE_BYTES };
