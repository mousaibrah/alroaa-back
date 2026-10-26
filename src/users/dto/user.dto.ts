import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Gender, User } from '../types/user.entity.js';

// Public representation of a user. Never includes the password hash.
export class UserDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'John' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty({ example: 'john.doe@example.com' })
  email: string;

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.png',
    nullable: true,
  })
  image: string | null;

  @ApiPropertyOptional({
    enum: [0, 1],
    nullable: true,
    description: '0 = male, 1 = female',
  })
  gender: Gender | null;

  @ApiPropertyOptional({ example: '1995-04-23', nullable: true })
  dob: string | null;

  @ApiProperty({ example: '+966' })
  countryCode: string;

  @ApiPropertyOptional({
    example: '501234567',
    nullable: true,
    description: 'National number, digits only (null for older accounts)',
  })
  phoneNumber: string | null;

  @ApiProperty({ example: 2 })
  roleId: number;

  @ApiProperty({ example: '2026-10-11T12:00:00.000Z' })
  createdAt: Date;

  static from(user: User): UserDto {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      image: user.image,
      gender: user.gender,
      dob: user.dob,
      countryCode: user.countryCode,
      phoneNumber: user.phoneNumber,
      roleId: user.roleId,
      createdAt: user.createdAt,
    };
  }
}
