import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsISO8601,
  Matches,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// Everyone who registers gets the `user` role; there is no role field.
export class RegisterDto {
  @ApiProperty({ example: 'John', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Doe', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: 'john.doe@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'StrongP@ssw0rd', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt ignores bytes past 72
  password: string;

  @ApiPropertyOptional({
    example: '+966',
    default: '+966',
    description: 'Dialing code; defaults to Saudi Arabia (+966)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{1,4}$/, { message: 'countryCode must look like +966' })
  countryCode?: string;

  @ApiProperty({
    example: '0501234567',
    description:
      'Phone number without the dialing code. Spaces, dashes and a leading 0 are allowed; it is stored as digits only (501234567).',
  })
  @IsString()
  @Matches(/^[0-9\s()-]{4,20}$/, {
    message: 'phoneNumber must contain digits only',
  })
  phoneNumber: string;

  @ApiPropertyOptional({ enum: [0, 1], description: '0 = male, 1 = female' })
  @IsOptional()
  // Multipart forms send numbers as text.
  @Type(() => Number)
  @IsIn([0, 1])
  gender?: 0 | 1;

  @ApiPropertyOptional({
    example: '1995-04-23',
    description: 'Date of birth (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dob must be in YYYY-MM-DD format',
  })
  dob?: string;
}

// Swagger only: the multipart form is the fields above plus the profile
// picture, which multer takes out of the body before validation.
export class RegisterFormDto extends RegisterDto {
  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description:
      'Profile picture (jpeg, png, webp, gif), optional. Saved as `image`; a 320px copy replaces it once processed.',
  })
  image?: unknown;
}
