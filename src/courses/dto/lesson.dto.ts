import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { LessonType } from '../../generated/prisma/enums.js';

export class CreateLessonDto {
  @ApiProperty({ example: 'Installing the tools', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: LessonType })
  @IsEnum(LessonType)
  lessonType: LessonType;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/lesson1.mp4' })
  @IsOptional()
  @IsUrl()
  contentUrl?: string;

  @ApiPropertyOptional({ example: 600, description: 'Duration in seconds' })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSec?: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Preview lessons are visible without enrolling',
  })
  @IsOptional()
  @IsBoolean()
  isPreview?: boolean;
}

export class UpdateLessonDto extends PartialType(CreateLessonDto) {}
