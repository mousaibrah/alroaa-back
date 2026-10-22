import {
  contentRef,
  resolveLessonContent,
} from '../utils/lesson-content.util.js';

const lesson = (over: object = {}) => ({
  contentUrlEn: null,
  contentUrlAr: null,
  contentMediaEn: null,
  contentMediaAr: null,
  ...over,
});

describe('resolveLessonContent', () => {
  it('prefers media over the legacy URL in the same language', () => {
    const media = { id: 'm1' };
    const out = resolveLessonContent(
      lesson({ contentUrlEn: 'https://x/en.mp4', contentMediaEn: media }),
      'en',
    );
    expect(out).toEqual({ source: 'media', media });
  });

  it('falls back to the legacy URL when no media is set', () => {
    expect(
      resolveLessonContent(lesson({ contentUrlEn: 'https://x/en.mp4' })),
    ).toEqual({ source: 'url', url: 'https://x/en.mp4' });
  });

  it('uses the asked language first, then the other one', () => {
    const l = lesson({
      contentUrlEn: 'https://x/en.mp4',
      contentMediaAr: { id: 'ar' },
    });
    expect(resolveLessonContent(l, 'ar')).toMatchObject({ source: 'media' });
    expect(resolveLessonContent(l, 'en')).toMatchObject({ source: 'url' });
    // EN has only a URL, AR only media: asking for AR still prefers AR media
    expect(
      resolveLessonContent(lesson({ contentMediaAr: { id: 'ar' } }), 'en'),
    ).toEqual({ source: 'media', media: { id: 'ar' } });
  });

  it('returns null when the lesson has no content', () => {
    expect(resolveLessonContent(lesson())).toBeNull();
  });
});

describe('contentRef', () => {
  it('points at media first, then the URL, else null', () => {
    expect(contentRef('m1', 'https://x')).toEqual({
      source: 'media',
      mediaId: 'm1',
    });
    expect(contentRef(null, 'https://x')).toEqual({
      source: 'url',
      url: 'https://x',
    });
    expect(contentRef(null, null)).toBeNull();
  });
});
