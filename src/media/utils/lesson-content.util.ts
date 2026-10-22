export type Lang = 'en' | 'ar';

export interface LessonContentSource<M> {
  contentUrlEn: string | null;
  contentUrlAr: string | null;
  contentMediaEn?: M | null;
  contentMediaAr?: M | null;
}

export type ResolvedContent<M> =
  { source: 'media'; media: M } | { source: 'url'; url: string };

// Precedence for one language: an uploaded media item wins over the legacy
// external URL.
const forLang = <M>(
  lesson: LessonContentSource<M>,
  lang: Lang,
): ResolvedContent<M> | null => {
  const media = lang === 'ar' ? lesson.contentMediaAr : lesson.contentMediaEn;
  if (media) return { source: 'media', media };
  const url = lang === 'ar' ? lesson.contentUrlAr : lesson.contentUrlEn;
  return url ? { source: 'url', url } : null;
};

// The asked language first; the other one is the fallback when a lesson exists
// in a single language.
export const resolveLessonContent = <M>(
  lesson: LessonContentSource<M>,
  lang: Lang = 'en',
): ResolvedContent<M> | null =>
  forLang(lesson, lang) ?? forLang(lesson, lang === 'en' ? 'ar' : 'en');

// What a language slot points at, for the people who edit the lesson (the
// stored URL is private, so learners never get this).
export type ContentRef =
  { source: 'media'; mediaId: string } | { source: 'url'; url: string };

export const contentRef = (
  mediaId: string | null | undefined,
  url: string | null | undefined,
): ContentRef | null =>
  mediaId ? { source: 'media', mediaId } : url ? { source: 'url', url } : null;
