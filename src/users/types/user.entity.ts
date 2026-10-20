import type { User as PrismaUser } from '../../generated/prisma/client.js';

// 0 = male, 1 = female
export type Gender = 0 | 1;

// A `users` row with the column types the API works with: `gender` as a number
// (Prisma returns BigInt) and `dob` as a YYYY-MM-DD string (Prisma returns Date).
export type User = Omit<PrismaUser, 'gender' | 'dob'> & {
  gender: Gender | null;
  dob: string | null;
};
