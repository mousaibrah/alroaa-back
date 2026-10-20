import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateProgressDto {
  @ApiProperty({
    example: 120,
    description: 'Furthest point reached in the lesson, in seconds',
  })
  @IsInt()
  @Min(0)
  @Max(86400)
  progressSec: number;

  @ApiPropertyOptional({
    description:
      'Marks a lesson WITHOUT a duration (e.g. text) as finished. Ignored for lessons with a duration: those complete from progressSec.',
  })
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
