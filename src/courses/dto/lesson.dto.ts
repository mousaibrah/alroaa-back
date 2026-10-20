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
  titleEn: string;

  @ApiProperty({ example: 'تثبيت الأدوات', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  titleAr: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descriptionEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descriptionAr?: string;

  @ApiProperty({ enum: LessonType })
  @IsEnum(LessonType)
  lessonType: LessonType;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/lesson1-en.mp4',
    description: 'English video/file. Fill only one if the lesson has a single language.',
  })
  @IsOptional()
  @IsUrl()
  contentUrlEn?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/lesson1-ar.mp4' })
  @IsOptional()
  @IsUrl()
  contentUrlAr?: string;

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
