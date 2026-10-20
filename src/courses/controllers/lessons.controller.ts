import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { Permission } from '../../auth/constants/permissions.js';
import { UpdateLessonDto } from '../dto/lesson.dto.js';
import { LessonsService } from '../services/lessons.service.js';

@ApiTags('Lessons')
@ApiBearerAuth()
@RequirePermissions(Permission.COURSES_UPDATE)
@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessons: LessonsService) {}

  @Patch(':id')
  @ApiOperation({ summary: 'Update a lesson' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLessonDto,
  ) {
    return this.lessons.update(id, user, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a lesson (soft delete)' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.lessons.remove(id, user);
  }
}
