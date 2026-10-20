import { Body, Controller, Param, ParseIntPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { Permission } from '../../auth/constants/permissions.js';
import { UpdateProgressDto } from '../dto/progress.dto.js';
import { ProgressService } from '../services/progress.service.js';

@ApiTags('Progress')
@ApiBearerAuth()
@Controller('lessons')
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Put(':id/progress')
  @RequirePermissions(Permission.COURSES_READ)
  @ApiOperation({
    summary:
      'Report lesson progress (call periodically while the learner watches)',
    description:
      'Completes the lesson at 95% of its duration and returns the lesson it unlocks.',
  })
  report(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProgressDto,
  ) {
    return this.progress.report(id, user, dto);
  }
}
