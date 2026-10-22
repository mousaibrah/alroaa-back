import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class PresignMediaDto {
  @ApiProperty({ example: 'lesson1.mp4', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename: string;

  @ApiProperty({ example: 'video/mp4' })
  @IsString()
  @MaxLength(100)
  mimeType: string;

  @ApiProperty({ example: 5242880, description: 'File size in bytes' })
  @IsInt()
  @Min(1)
  size: number;

  @ApiPropertyOptional({
    default: false,
    description:
      'Private files are only served through short-lived signed URLs',
  })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}

export class ListMediaQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
