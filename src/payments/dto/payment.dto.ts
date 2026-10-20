import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsString, Length, Min } from 'class-validator';

export class PaymentWebhookDto {
  @ApiProperty({
    description: 'Payment id returned by the gateway at checkout',
  })
  @IsString()
  @Length(1, 255)
  providerPaymentId: string;

  @ApiProperty({
    description: 'Unique id of this charge attempt (idempotency)',
  })
  @IsString()
  @Length(1, 255)
  providerTransactionId: string;

  @ApiProperty({ enum: ['success', 'failed'] })
  @IsIn(['success', 'failed'])
  status: 'success' | 'failed';

  @ApiProperty({ example: 49.99 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @Length(3, 3)
  currency: string;
}
