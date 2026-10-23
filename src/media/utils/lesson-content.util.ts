export interface LessonContentSource<M> {
  contentUrl: string | null;
  contentMedia?: M | null;
}

export type ResolvedContent<M> =
  { source: 'media'; media: M } | { source: 'url'; url: string };

// The processed media (web MP4) once it is ready; until then the stored URL,
// which points at the uploaded file. Media without a URL is still returned so
// the caller can say it is not ready yet.
export const resolveLessonContent = <M extends { status: string }>(
  lesson: LessonContentSource<M>,
): ResolvedContent<M> | null => {
  const media = lesson.contentMedia;
  if (media?.status === 'ready') return { source: 'media', media };
  if (lesson.contentUrl) return { source: 'url', url: lesson.contentUrl };
  return media ? { source: 'media', media } : null;
};

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
