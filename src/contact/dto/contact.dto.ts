import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class ContactDto {
  @ApiProperty({ example: 'John Doe', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName: string;

  @ApiProperty({ example: '+966500000000', maxLength: 20 })
  @IsString()
  @Matches(/^\+?[0-9\s-]{7,20}$/, {
    message: 'phoneNumber must be a valid phone number',
  })
  phoneNumber: string;

  @ApiProperty({ example: 'john.doe@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({
    example: 'I would like to know more about...',
    maxLength: 5000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message: string;
}
