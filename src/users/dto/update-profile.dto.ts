import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// The details a user may change without their password. Email and password
// have their own endpoints, which ask for the current password.
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({
    enum: [0, 1],
    nullable: true,
    description: '0 = male, 1 = female; null clears it',
  })
  @IsOptional()
  @IsIn([0, 1])
  gender?: 0 | 1 | null;

  @ApiPropertyOptional({
    example: '1995-04-23',
    nullable: true,
    description: 'Date of birth (YYYY-MM-DD); null clears it',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dob must be in YYYY-MM-DD format',
  })
  dob?: string | null;
}
