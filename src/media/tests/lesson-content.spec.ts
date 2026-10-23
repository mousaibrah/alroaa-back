import {
  contentStatus,
  resolveLessonContent,
} from '../utils/lesson-content.util.js';

const lesson = (
  over: {
    contentUrl?: string | null;
    contentMedia?: { id: string; status: string } | null;
  } = {},
) => ({ contentUrl: null, contentMedia: null, ...over });

describe('resolveLessonContent', () => {
  const url = 'https://x/a.mp4';

  it('prefers ready media over the URL', () => {
    const media = { id: 'm1', status: 'ready' };
    expect(
      resolveLessonContent(lesson({ contentUrl: url, contentMedia: media })),
    ).toEqual({ source: 'media', media });
  });

  it('uses the URL while the media is not ready (or failed)', () => {
    for (const status of ['uploaded', 'processing', 'failed']) {
      expect(
        resolveLessonContent(
          lesson({ contentUrl: url, contentMedia: { id: 'm1', status } }),
        ),
      ).toEqual({ source: 'url', url });
    }
  });

  it('returns unready media when there is no URL', () => {
    const media = { id: 'm1', status: 'processing' };
    expect(resolveLessonContent(lesson({ contentMedia: media }))).toEqual({
      source: 'media',
      media,
    });
  });

  it('falls back to the URL when no media is set', () => {
    expect(resolveLessonContent(lesson({ contentUrl: url }))).toEqual({
      source: 'url',
      url,
    });
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
