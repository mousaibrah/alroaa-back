import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
  PartialType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
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
    example: 600,
    description:
      'Duration in seconds. Leave empty to have it read from the uploaded video.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationSec?: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Preview lessons are visible without enrolling',
  })
  @IsOptional()
  // Multipart forms send "true"/"false" as text.
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isPreview?: boolean;
}

export class UpdateLessonDto extends PartialType(CreateLessonDto) {}

// Swagger only: the multipart form is the lesson fields plus the files, which
// multer takes out of the body before validation.
class LessonFiles {
  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description:
      'Video (video lesson) or image (text lesson). Required when creating. Processed in the background; contentUrl is set when done.',
  })
  file?: unknown;
}

export class CreateLessonFormDto extends IntersectionType(
  CreateLessonDto,
  LessonFiles,
) {}

export class UpdateLessonFormDto extends IntersectionType(
  UpdateLessonDto,
  LessonFiles,
) {}
