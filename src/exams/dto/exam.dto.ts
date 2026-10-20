import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  Max,
  ValidateNested,
} from 'class-validator';
import { QuestionType } from '../../generated/prisma/enums.js';

export class CreateExamDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  titleEn: string;

  @ApiProperty({ maxLength: 255 })
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

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999.99)
  passingScore?: number;

  @ApiPropertyOptional({ description: 'Time limit in seconds' })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSec?: number;
}

export class OptionInputDto {
  @ApiPropertyOptional({ description: 'Present for an existing option' })
  @IsOptional()
  @IsInt()
  id?: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  optionTextEn: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  optionTextAr: string;

  @ApiProperty()
  @IsBoolean()
  isCorrect: boolean;
}

export class QuestionInputDto {
  @ApiPropertyOptional({ description: 'Present for an existing question' })
  @IsOptional()
  @IsInt()
  id?: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  textEn: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  textAr: string;

  @ApiProperty({ enum: QuestionType })
  @IsEnum(QuestionType)
  questionType: QuestionType;

  @ApiProperty({ example: 1 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999.99)
  points: number;

  @ApiProperty({ type: [OptionInputDto] })
  @ValidateNested({ each: true })
  @Type(() => OptionInputDto)
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  options: OptionInputDto[];
}

// Whole-exam save used by the form builder. Array order is the display order.
export class SaveExamDto extends CreateExamDto {
  @ApiProperty({ type: [QuestionInputDto] })
  @ValidateNested({ each: true })
  @Type(() => QuestionInputDto)
  @ArrayMaxSize(200)
  questions: QuestionInputDto[];
}
