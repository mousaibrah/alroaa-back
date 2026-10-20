import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { Permission } from '../../auth/constants/permissions.js';
import { CreateLessonDto } from '../dto/lesson.dto.js';
import { ReorderDto } from '../dto/reorder.dto.js';
import { UpdateSectionDto } from '../dto/section.dto.js';
import { LessonsService } from '../services/lessons.service.js';
import { SectionsService } from '../services/sections.service.js';

@ApiTags('Sections')
@ApiBearerAuth()
@RequirePermissions(Permission.COURSES_UPDATE)
@Controller('sections')
export class SectionsController {
  constructor(
    private readonly sections: SectionsService,
    private readonly lessons: LessonsService,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: 'Update a section' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSectionDto,
  ) {
    return this.sections.update(id, user, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a section and its lessons (soft delete)' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.sections.remove(id, user);
  }

  @Post(':sectionId/lessons')
  @ApiOperation({ summary: 'Add a lesson at the end of the section' })
  addLesson(
    @CurrentUser() user: JwtPayload,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: CreateLessonDto,
  ) {
    return this.lessons.create(sectionId, user, dto);
  }

  @Put(':sectionId/lessons/order')
  @ApiOperation({ summary: 'Set the order of all lessons of the section' })
  reorderLessons(
    @CurrentUser() user: JwtPayload,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: ReorderDto,
  ) {
    return this.lessons.reorder(sectionId, user, dto.ids);
  }
}
