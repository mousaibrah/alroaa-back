export interface LessonContentSource<M> {
  contentUrl: string | null;
  contentMedia?: M | null;
}

export type ResolvedContent<M> =
  { source: 'media'; media: M } | { source: 'url'; url: string };

// An uploaded media item wins over the stored URL.
export const resolveLessonContent = <M>(
  lesson: LessonContentSource<M>,
): ResolvedContent<M> | null =>
  lesson.contentMedia
    ? { source: 'media', media: lesson.contentMedia }
    : lesson.contentUrl
      ? { source: 'url', url: lesson.contentUrl }
      : null;

// Where the lesson's file is, for the people who edit the lesson: being
// processed, ready (contentUrl is set) or failed. null when there is none.
export const contentStatus = (lesson: {
  contentUrl: string | null;
  contentMedia?: { status: string } | null;
}): 'processing' | 'ready' | 'failed' | null => {
  const status = lesson.contentMedia?.status;
  if (status === 'failed') return 'failed';
  if (status && status !== 'ready') return 'processing';
  return lesson.contentUrl || status ? 'ready' : null;
};
