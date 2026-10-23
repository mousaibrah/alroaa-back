import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { Permission } from '../../auth/constants/permissions.js';
import {
  CoursesService,
  type CourseUploads,
} from '../services/courses.service.js';
import {
  CreateCourseDto,
  CreateCourseFormDto,
  ListCoursesQueryDto,
  UpdateCourseDto,
  UpdateCourseFormDto,
} from '../dto/course.dto.js';
import { UploadFieldsInterceptor } from '../../media/utils/upload.interceptor.js';
import { ReorderDto } from '../dto/reorder.dto.js';
import { CreateSectionDto } from '../dto/section.dto.js';
import { SectionsService } from '../services/sections.service.js';

@ApiTags('Courses')
@ApiBearerAuth()
@Controller('courses')
export class CoursesController {
  constructor(
    private readonly courses: CoursesService,
    private readonly sections: SectionsService,
  ) {}

  @Post()
  @RequirePermissions(Permission.COURSES_CREATE)
  @ApiOperation({
    summary: 'Create a course (starts as a draft)',
    description:
      'Send `thumbnailMediaId` / `introVideoMediaId` (files uploaded with POST /media/multipart; best for large videos) or multipart/form-data with the cover image in `thumbnail` and the intro video in `introVideo` (all optional).',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: CreateCourseFormDto })
  @UseInterceptors(UploadFieldsInterceptor('thumbnail', 'introVideo'))
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCourseDto,
    @UploadedFiles() files?: CourseUploads,
  ) {
    return this.courses.create(user, dto, files);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary:
      'List published courses (open to guests), or your own with ?mine=true',
  })
  list(
    @CurrentUser() user: JwtPayload | undefined,
    @Query() query: ListCoursesQueryDto,
  ) {
    return this.courses.list(user, query);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Get a course with its sections and lessons (open to guests)',
  })
  get(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.courses.get(id, user);
  }

  @Patch(':id')
  @RequirePermissions(Permission.COURSES_UPDATE)
  @ApiOperation({
    summary: 'Update a course (author or admin)',
    description:
      'To replace the cover or intro video, send `thumbnailMediaId` / `introVideoMediaId` (files uploaded with POST /media/multipart) or multipart/form-data with `thumbnail` / `introVideo`.',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: UpdateCourseFormDto })
  @UseInterceptors(UploadFieldsInterceptor('thumbnail', 'introVideo'))
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCourseDto,
    @UploadedFiles() files?: CourseUploads,
  ) {
    return this.courses.update(id, user, dto, files);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.COURSES_DELETE)
  @ApiOperation({ summary: 'Delete a course (soft delete)' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.courses.remove(id, user);
  }

  @Post(':courseId/sections')
  @RequirePermissions(Permission.COURSES_UPDATE)
  @ApiOperation({ summary: 'Add a section at the end of the course' })
  addSection(
    @CurrentUser() user: JwtPayload,
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: CreateSectionDto,
  ) {
    return this.sections.create(courseId, user, dto);
  }

  @Put(':courseId/sections/order')
  @RequirePermissions(Permission.COURSES_UPDATE)
  @ApiOperation({ summary: 'Set the order of all sections of the course' })
  reorderSections(
    @CurrentUser() user: JwtPayload,
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: ReorderDto,
  ) {
    return this.sections.reorder(courseId, user, dto.ids);
  }
}
