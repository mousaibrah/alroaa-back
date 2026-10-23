import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
  PartialType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CourseStatus } from '../../generated/prisma/enums.js';

export class CreateCourseDto {
  @ApiProperty({ example: 'Intro to TypeScript', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  titleEn: string;

  @ApiProperty({ example: 'مقدمة في تايب سكريبت', maxLength: 255 })
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

  @ApiPropertyOptional({ example: 49.99, default: 0 })
  @IsOptional()
  // Multipart forms send numbers as text.
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  price?: number;

  @ApiPropertyOptional({ example: 'USD', default: 'USD' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
  currency?: string;
}

export class UpdateCourseDto extends PartialType(CreateCourseDto) {
  @ApiPropertyOptional({ enum: CourseStatus })
  @IsOptional()
  @IsEnum(CourseStatus)
  status?: CourseStatus;
}

// Swagger only: the multipart form is the course fields plus the cover image
// and intro video,
// which multer takes out of the body before validation.
class CourseFiles {
  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description:
      'Cover image (jpeg, png, webp, gif). Stored and saved as thumbnailUrl; resized in the background.',
  })
  thumbnail?: unknown;

  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description:
      'Introduction video (mp4, webm, mov) for the overview page. Saved as introVideoUrl; processed in the background.',
  })
  introVideo?: unknown;
}

export class CreateCourseFormDto extends IntersectionType(
  CreateCourseDto,
  CourseFiles,
) {}

export class UpdateCourseFormDto extends IntersectionType(
  UpdateCourseDto,
  CourseFiles,
) {}

export class ListCoursesQueryDto {
  @ApiPropertyOptional({
    description: "List only the caller's own courses, drafts included",
  })
  @IsOptional()
  // Boolean('false') is true, so parse the query string explicitly.
  @Transform(({ value }) => value === true || value === 'true')
  mine?: boolean;

  @ApiPropertyOptional({
    description: 'Admin only: list every course, drafts and archived included',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  all?: boolean;

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
