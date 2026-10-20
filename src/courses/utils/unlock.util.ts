import { COMPLETION_THRESHOLD } from '../constants/progress.constants.js';
import type { OrderedLesson } from '../types/ordered-lesson.types.js';

// True once `progressSec` reaches the completion threshold of the duration.
// Lessons without a duration (e.g. text) can't be measured, so they are never
// completed by progress alone: the client has to say so explicitly.
export const reachedThreshold = (
  progressSec: number,
  durationSec: number | null,
): boolean =>
  durationSec !== null &&
  durationSec > 0 &&
  progressSec >= durationSec * COMPLETION_THRESHOLD;

// Lessons are taken in course order (sections, then lessons). A lesson is
// unlocked when it is the first one or the lesson before it is completed.
export function unlockedLessonIds(
  ordered: OrderedLesson[],
  completed: ReadonlySet<number>,
): Set<number> {
  const unlocked = new Set<number>();
  ordered.forEach((lesson, index) => {
    if (index === 0 || completed.has(ordered[index - 1].id)) {
      unlocked.add(lesson.id);
    }
  });
  return unlocked;
}
