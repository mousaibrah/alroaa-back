import type { Course } from '../../generated/prisma/client.js';
import { toCourse } from '../utils/course.mapper.js';

const course = (over: object = {}) =>
  ({
    id: 1,
    price: 0,
    thumbnailUrl: 'https://old/cover.png',
    thumbnailMediaId: null,
    thumbnailMedia: null,
    ...over,
  }) as unknown as Course & { thumbnailMedia: never };
const url = (key: string) => `https://s3/${key}`;

describe('toCourse thumbnail', () => {
  it('keeps the legacy URL when no media is set', () => {
    expect(toCourse(course(), url).thumbnailUrl).toBe('https://old/cover.png');
  });

  it('prefers a ready uploaded cover (its medium variant)', () => {
    const media = {
      key: 'media/a.png',
      status: 'ready',
      variants: { medium: { key: 'media/a/medium.webp' } },
    };
    const out = toCourse(
      course({ thumbnailMediaId: 'm1', thumbnailMedia: media }),
      url,
    );
    expect(out.thumbnailUrl).toBe('https://s3/media/a/medium.webp');
    expect(out.thumbnailMediaId).toBe('m1');
  });

  it('falls back to the legacy URL while the cover is not ready', () => {
    const media = { key: 'media/a.png', status: 'processing', variants: null };
    expect(toCourse(course({ thumbnailMedia: media }), url).thumbnailUrl).toBe(
      'https://old/cover.png',
    );
  });
});
