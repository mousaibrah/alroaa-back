// Unicode-aware so Arabic titles keep their letters.
export const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200) || 'course';

// With the pg driver adapter Prisma has no `meta.target`: the violated
// constraint name (courses_slug_key) is nested in `meta.driverAdapterError`.
export const isSlugConflict = (error: unknown): boolean => {
  const e = error as { code?: string; meta?: unknown };
  return e.code === 'P2002' && JSON.stringify(e.meta ?? {}).includes('slug');
};
