import { BadRequestException } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);

// Latest timezone offset on Earth (UTC+14): a user's local "today" can be
// up to 14h ahead of UTC, so that is the tolerance for the future-dob check.
const MAX_UTC_OFFSET_HOURS = 14;

// dob is a calendar date (no time, no timezone): compared as YYYY-MM-DD and
// never converted through a timezone.
export const assertDobNotInFuture = (dob: string | null | undefined): void => {
  if (
    dob &&
    dob > dayjs.utc().add(MAX_UTC_OFFSET_HOURS, 'hour').format('YYYY-MM-DD')
  ) {
    throw new BadRequestException('dob cannot be in the future');
  }
};
