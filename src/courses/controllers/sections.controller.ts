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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { Permission } from '../../auth/constants/permissions.js';
import { CreateLessonDto, CreateLessonFormDto } from '../dto/lesson.dto.js';
import { ReorderDto } from '../dto/reorder.dto.js';
import { UpdateSectionDto } from '../dto/section.dto.js';
import type { TempFile } from '../../media/services/media.service.js';
import { LessonsService } from '../services/lessons.service.js';
import { UploadInterceptor } from '../../media/utils/upload.interceptor.js';
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
  @ApiOperation({
    summary: 'Add a lesson at the end of the section',
    description:
      'Send multipart/form-data with a `file` field to upload the content; the stored file URL is saved on the lesson.',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: CreateLessonFormDto })
  @UseInterceptors(UploadInterceptor('file'))
  addLesson(
    @CurrentUser() user: JwtPayload,
    @Param('sectionId', ParseIntPipe) sectionId: number,
    @Body() dto: CreateLessonDto,
    @UploadedFile() file?: TempFile,
  ) {
    return this.lessons.create(sectionId, user, dto, file);
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
