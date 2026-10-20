import { Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { Permission } from '../auth/constants/permissions.js';
import type { JwtPayload } from '../auth/types/jwt-payload.js';
import { CertificatesService } from './certificates.service.js';

@ApiTags('Certificates')
@Controller('certificates')
export class CertificatesController {
	constructor(private readonly certificates: CertificatesService) {}

	@Get('me')
	@ApiBearerAuth()
	@ApiOperation({ summary: 'My certificates' })
	mine(@CurrentUser() user: JwtPayload) {
		return this.certificates.listMine(user);
	}

	@Post('courses/:courseId')
	@HttpCode(HttpStatus.OK)
	@ApiBearerAuth()
	@RequirePermissions(Permission.EXAMS_TAKE)
	@ApiOperation({
		summary: 'Get my certificate for a course',
		description:
			'Issues the certificate once every exam of the course is passed (it is also issued automatically when the last exam is passed). Idempotent: returns the existing one. 403 while the course is not finished.',
	})
	issue(@CurrentUser() user: JwtPayload, @Param('courseId', ParseIntPipe) courseId: number) {
		return this.certificates.issueForCourse(user, courseId);
	}

	@Get('verify/:code')
	@Public()
	@ApiOperation({
		summary: 'Check a certificate by its code (open to everyone)',
		description: 'Returns the holder, the program and the issue date, or 404 when no such certificate exists.',
	})
	verify(@Param('code') code: string) {
		return this.certificates.verify(code);
	}
}
