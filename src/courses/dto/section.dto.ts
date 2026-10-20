import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSectionDto {
  @ApiProperty({ example: 'Getting started', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  titleEn: string;

  @ApiProperty({ example: 'البداية', maxLength: 255 })
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
}

export class UpdateSectionDto extends PartialType(CreateSectionDto) {}
