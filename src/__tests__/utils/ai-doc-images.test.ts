import { describe, expect, it } from 'vitest';
import { capDocImages, extractLocalImageRefs, isRemoteOrDataImage, isWithinImageBudget, resolveImagePath } from '../../utils/ai-doc-images';

describe('extractLocalImageRefs', () => {
  it('resolves relative paths against the note directory', () => {
    const md = 'See ![Gantt](assets/gantt.png) and ![again](assets/gantt.png)';
    const refs = extractLocalImageRefs(md, 'D:/notes');
    expect(refs).toEqual([
      { alt: 'Gantt', src: 'assets/gantt.png', absolutePath: 'D:/notes/assets/gantt.png' },
    ]);
  });

  it('keeps absolute paths and skips remote/data sources', () => {
    const md = [
      '![a](https://example.com/a.png)',
      '![b](data:image/png;base64,xx)',
      '![c](E:/scans/page.jpg)',
    ].join('\n');
    const refs = extractLocalImageRefs(md, 'D:/notes');
    expect(refs.map(r => r.absolutePath)).toEqual(['E:/scans/page.jpg']);
  });

  it('skips relative images when no baseDir is given', () => {
    expect(extractLocalImageRefs('![x](a.png)')).toEqual([]);
  });
});

describe('resolveImagePath', () => {
  it('normalizes parent segments', () => {
    expect(resolveImagePath('../img.png', 'D:/notes/sub')).toBe('D:/notes/img.png');
  });
});

describe('capDocImages', () => {
  it('keeps the first four', () => {
    expect(capDocImages([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4]);
  });
});

describe('isWithinImageBudget', () => {
  it('rejects empty and oversized files', () => {
    expect(isWithinImageBudget(0)).toBe(false);
    expect(isWithinImageBudget(8 * 1024 * 1024)).toBe(true);
    expect(isWithinImageBudget(8 * 1024 * 1024 + 1)).toBe(false);
  });
});

describe('isRemoteOrDataImage', () => {
  it('detects http and data uris', () => {
    expect(isRemoteOrDataImage('https://x/y.png')).toBe(true);
    expect(isRemoteOrDataImage('blob:abc')).toBe(true);
    expect(isRemoteOrDataImage('assets/a.png')).toBe(false);
  });
});
