import type { Gender } from '../types/user.entity.js';

// Data needed to insert a row into `users`. `password` must already be hashed.
export class CreateUserDto {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  image: string | null;
  imageMediaId?: string | null;
  gender: Gender | null;
  dob: string | null; // YYYY-MM-DD
  countryCode: string; // e.g. +966
  phoneNumber: string; // national number, digits only
  roleId: number;
}
