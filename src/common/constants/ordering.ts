// Prisma `orderBy` for anything that has a manual order (sections, lessons,
// questions, options): the position first, then the id for a stable result.
export const ORDER = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }];
