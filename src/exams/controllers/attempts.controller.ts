import {
  Body,
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
import { AttemptsService } from '../services/attempts.service.js';
import { SubmitAttemptDto } from '../dto/attempt.dto.js';

@ApiTags('Exam attempts')
@ApiBearerAuth()
@RequirePermissions(Permission.EXAMS_TAKE)
@Controller()
export class AttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  @Post('exams/:id/attempts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start the exam (or resume the unfinished attempt)',
    description:
      'Requires enrollment, payment and every lesson completed. Returns the questions WITHOUT the correct answers, and the deadline.',
  })
  start(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.attempts.start(id, user);
  }

  @Get('exams/:id/attempts')
  @ApiOperation({ summary: 'My attempts at this exam' })
  mine(@CurrentUser() user: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.attempts.listMine(id, user);
  }

  @Get('attempts/:id')
  @ApiOperation({
    summary:
      'An attempt: the questions while open, the graded review once done',
  })
  get(@CurrentUser() user: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.attempts.get(id, user);
  }

  @Post('attempts/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit the answers: graded on the server',
    description:
      'Returns the score, pass/fail and the review with the correct answers. Submitting again returns the same result; after the deadline the attempt expires with no answers counted.',
  })
  submit(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitAttemptDto,
  ) {
    return this.attempts.submit(id, user, dto);
  }
}
