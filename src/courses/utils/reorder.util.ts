import { BadRequestException } from '@nestjs/common';

// A reorder request must list exactly the current siblings, no more, no less,
// so a stale client can never silently drop or duplicate an item.
export function assertSameIds(existing: number[], requested: number[]): void {
  const current = new Set(existing);
  const unique = new Set(requested);
  const matches =
    unique.size === requested.length &&
    unique.size === current.size &&
    requested.every((id) => current.has(id));
  if (!matches) {
    throw new BadRequestException(
      'ids must contain every item exactly once (the list may be out of date)',
    );
  }
}
