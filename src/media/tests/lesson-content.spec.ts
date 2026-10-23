import {
  contentStatus,
  resolveLessonContent,
} from '../utils/lesson-content.util.js';

const lesson = (over: object = {}) => ({
  contentUrl: null,
  contentMedia: null,
  ...over,
});

describe('resolveLessonContent', () => {
  it('prefers media over the URL', () => {
    const media = { id: 'm1' };
    const out = resolveLessonContent(
      lesson({ contentUrl: 'https://x/a.mp4', contentMedia: media }),
    );
    expect(out).toEqual({ source: 'media', media });
  });

  it('falls back to the URL when no media is set', () => {
    expect(
      resolveLessonContent(lesson({ contentUrl: 'https://x/a.mp4' })),
    ).toEqual({ source: 'url', url: 'https://x/a.mp4' });
  });

  it('returns null when the lesson has no content', () => {
    expect(resolveLessonContent(lesson())).toBeNull();
  });
});

describe('contentStatus', () => {
  it('is processing until the media is ready', () => {
    for (const status of ['uploaded', 'processing']) {
      expect(
        contentStatus({ contentUrl: null, contentMedia: { status } }),
      ).toBe('processing');
    }
  });

  it('is ready once the URL is set, failed when processing failed', () => {
    expect(
      contentStatus({
        contentUrl: 'https://x',
        contentMedia: { status: 'ready' },
      }),
    ).toBe('ready');
    expect(contentStatus({ contentUrl: 'https://x' })).toBe('ready');
    expect(
      contentStatus({ contentUrl: null, contentMedia: { status: 'failed' } }),
    ).toBe('failed');
  });

  it('is null when the lesson has no content', () => {
    expect(contentStatus({ contentUrl: null, contentMedia: null })).toBeNull();
  });
});
