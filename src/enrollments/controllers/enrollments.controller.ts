import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { Permission } from '../../auth/constants/permissions.js';
import { EnrollmentsService } from '../services/enrollments.service.js';

@ApiTags('Enrollments')
@ApiBearerAuth()
@Controller()
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Post('courses/:id/enroll')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.ENROLLMENTS_CREATE)
  @ApiOperation({
    summary: 'Enroll in a course',
    description:
      'Required before any lesson opens, free ones included. Idempotent. `paymentRequired` tells whether the paid lessons still need a payment.',
  })
  enroll(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.enrollments.enroll(id, user);
  }

  @Get('enrollments/me')
  @RequirePermissions(Permission.ENROLLMENTS_CREATE)
  @ApiOperation({ summary: 'My enrollments' })
  mine(@CurrentUser() user: JwtPayload) {
    return this.enrollments.listMine(user);
  }
}
