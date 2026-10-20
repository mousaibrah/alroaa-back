import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, ValidateNested } from 'class-validator';

export class AnswerDto {
  @ApiProperty()
  @IsInt()
  questionId: number;

  @ApiProperty({
    type: [Number],
    description: 'Selected option ids. Empty = left unanswered.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  optionIds: number[];
}

export class SubmitAttemptDto {
  @ApiProperty({ type: [AnswerDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers: AnswerDto[];
}
