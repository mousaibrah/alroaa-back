import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, Matches, MaxLength } from 'class-validator';

// Returned by register, and by login while the email is not verified: no
// token yet, the frontend opens the code screen instead.
export class VerificationRequiredDto {
  @ApiProperty({ example: true })
  verificationRequired: true;

  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'Where the code was sent',
  })
  email: string;

  @ApiProperty({
    example: 60,
    description: 'Seconds until another code can be requested',
  })
  resendAvailableIn: number;
}

export class VerifyEmailDto {
  @ApiProperty({ example: 'john.doe@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: '123456', description: 'The 6-digit emailed code' })
  @Matches(/^[0-9]{6}$/, { message: 'code must be 6 digits' })
  code: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'john.doe@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;
}

export class ResendVerificationResponseDto {
  @ApiProperty({
    example: 60,
    description: 'Seconds until another code can be requested',
  })
  resendAvailableIn: number;
}
