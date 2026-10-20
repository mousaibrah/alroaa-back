import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CertificatesModule } from './certificates/certificates.module.js';
import { CoursesModule } from './courses/courses.module.js';
import { EnrollmentsModule } from './enrollments/enrollments.module.js';
import { ExamsModule } from './exams/exams.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
	imports: [
		PrismaModule,
		AuthModule,
		CoursesModule,
		ExamsModule,
		CertificatesModule,
		EnrollmentsModule,
		PaymentsModule,
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule {}
