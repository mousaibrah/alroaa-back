import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldP@ssw0rd' })
  @IsString()
  @MaxLength(72)
  currentPassword: string;

  @ApiProperty({ example: 'NewStr0ngP@ss', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt ignores bytes past 72
  newPassword: string;
}

export class ChangeEmailDto {
  @ApiProperty({ example: 'new.address@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'CurrentP@ssw0rd' })
  @IsString()
  @MaxLength(72)
  currentPassword: string;
}
