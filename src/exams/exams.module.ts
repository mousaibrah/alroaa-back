import { Module } from '@nestjs/common';
import { CertificatesModule } from '../certificates/certificates.module.js';
import { CoursesModule } from '../courses/courses.module.js';
import { AttemptsController } from './controllers/attempts.controller.js';
import { AttemptsService } from './services/attempts.service.js';
import { ExamsController } from './controllers/exams.controller.js';
import { ExamsService } from './services/exams.service.js';

@Module({
	imports: [CoursesModule, CertificatesModule],
	controllers: [ExamsController, AttemptsController],
	providers: [ExamsService, AttemptsService],
})
export class ExamsModule {}
