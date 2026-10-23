import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
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
import { UpdateLessonDto, UpdateLessonFormDto } from '../dto/lesson.dto.js';
import type { TempFile } from '../../media/services/media.service.js';
import { LessonsService } from '../services/lessons.service.js';
import { UploadInterceptor } from '../../media/utils/upload.interceptor.js';

@ApiTags('Lessons')
@ApiBearerAuth()
@RequirePermissions(Permission.COURSES_UPDATE)
@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessons: LessonsService) {}

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a lesson',
    description:
      'Send multipart/form-data with a `file` field to replace the content with an uploaded file.',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: UpdateLessonFormDto })
  @UseInterceptors(UploadInterceptor('file'))
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLessonDto,
    @UploadedFile() file?: TempFile,
  ) {
    return this.lessons.update(id, user, dto, file);
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
