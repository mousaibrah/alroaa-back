import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsInt } from 'class-validator';

export class ReorderDto {
  @ApiProperty({
    example: [3, 1, 2],
    description:
      'Every sibling id (sections of a course, or lessons of a section) in the new order',
  })
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  ids: number[];
}
