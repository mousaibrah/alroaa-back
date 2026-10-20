import { Module } from '@nestjs/common';
import { EnrollmentsController } from './controllers/enrollments.controller.js';
import { EnrollmentsService } from './services/enrollments.service.js';

@Module({
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService],
})
export class EnrollmentsModule {}
