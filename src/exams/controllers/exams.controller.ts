import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { Permission } from '../../auth/constants/permissions.js';
import { CreateExamDto, SaveExamDto } from '../dto/exam.dto.js';
import { ExamsService } from '../services/exams.service.js';

@ApiTags('Exams')
@ApiBearerAuth()
@RequirePermissions(Permission.EXAMS_MANAGE)
@Controller()
export class ExamsController {
  constructor(private readonly exams: ExamsService) {}

  @Get('courses/:courseId/exams')
  @ApiOperation({ summary: 'List the exams of a course' })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('courseId', ParseIntPipe) courseId: number,
  ) {
    return this.exams.listForCourse(courseId, user);
  }

  @Post('courses/:courseId/exams')
  @ApiOperation({ summary: 'Create an empty exam in a course' })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: CreateExamDto,
  ) {
    return this.exams.create(courseId, user, dto);
  }

  @Get('exams/:id')
  @ApiOperation({ summary: 'Get an exam with questions and correct answers' })
  get(@CurrentUser() user: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.exams.get(id, user);
  }

  @Put('exams/:id')
  @ApiOperation({
    summary: 'Save the whole exam (form builder)',
    description:
      'Questions/options with an id are updated, without an id created, and missing ones removed. Array order is the display order.',
  })
  save(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveExamDto,
  ) {
    return this.exams.save(id, user, dto);
  }

  @Delete('exams/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an exam (soft delete)' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.exams.remove(id, user);
  }
}
