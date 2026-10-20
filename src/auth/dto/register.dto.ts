import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsISO8601,
  Matches,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { RegisterRole } from '../../users/types/user-role.enum.js';

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

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  @IsOptional()
  @IsUrl()
  image?: string;

  @ApiPropertyOptional({ enum: [0, 1], description: '0 = male, 1 = female' })
  @IsOptional()
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

  @ApiPropertyOptional({
    enum: RegisterRole,
    default: RegisterRole.STUDENT,
    description: 'Role to register as. `admin` cannot be chosen here.',
  })
  @IsOptional()
  @IsEnum(RegisterRole)
  role?: RegisterRole;
}
