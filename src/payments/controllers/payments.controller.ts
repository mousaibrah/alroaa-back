import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Public } from '../../auth/decorators/public.decorator.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { Permission } from '../../auth/constants/permissions.js';
import { PaymentWebhookDto } from '../dto/payment.dto.js';
import { PAYMENT_PROVIDER } from '../constants/payment.constants.js';
import type { PaymentProvider } from '../types/payment-provider.types.js';
import { PaymentsService } from '../services/payments.service.js';

@ApiTags('Payments')
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  @Post('courses/:id/payments')
  @ApiBearerAuth()
  @RequirePermissions(Permission.ENROLLMENTS_CREATE)
  @ApiOperation({
    summary: 'Start the payment that unlocks a course’s paid lessons',
    description:
      'Call this when the learner reaches a lesson with `paymentRequired`. Send them to `checkoutUrl`; access opens once the gateway confirms.',
  })
  init(@CurrentUser() user: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payments.init(id, user);
  }

  @Get('payments/:id')
  @ApiBearerAuth()
  @RequirePermissions(Permission.ENROLLMENTS_CREATE)
  @ApiOperation({
    summary: 'Payment status (poll after returning from checkout)',
  })
  get(@CurrentUser() user: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.payments.get(id, user);
  }

  @Post('payments/:id/mock-confirm')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @RequirePermissions(Permission.ENROLLMENTS_CREATE)
  @ApiOperation({
    summary:
      'DEV ONLY: complete a mock payment (404 outside the mock provider)',
  })
  mockConfirm(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.payments.mockConfirm(id, user);
  }

  @Public()
  @Post('payments/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gateway callback (authenticated by the x-signature HMAC header)',
  })
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature: string | undefined,
    @Body() dto: PaymentWebhookDto,
  ) {
    if (!req.rawBody || !this.provider.verifyWebhook(req.rawBody, signature)) {
      throw new UnauthorizedException('Invalid signature');
    }
    return this.payments.settle(dto);
  }
}
