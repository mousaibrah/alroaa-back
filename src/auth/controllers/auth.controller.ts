import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator.js';
import { AuthService } from '../services/auth.service.js';
import { AuthResponseDto } from '../dto/auth-response.dto.js';
import {
  ResendVerificationDto,
  ResendVerificationResponseDto,
  VerificationRequiredDto,
  VerifyEmailDto,
} from '../dto/email-verification.dto.js';
import { LoginDto } from '../dto/login.dto.js';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
} from '../dto/password-reset.dto.js';
import { RegisterDto, RegisterFormDto } from '../dto/register.dto.js';
import type { TempFile } from '../../media/services/media.service.js';
import { UploadInterceptor } from '../../media/utils/upload.interceptor.js';

@Public()
@ApiTags('Auth')
@ApiExtraModels(AuthResponseDto, VerificationRequiredDto)
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'JSON, or multipart/form-data with an optional profile picture in `image`. Emails a 6-digit code and returns no token: open the code screen and call POST /auth/verify-email.',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: RegisterFormDto })
  @ApiCreatedResponse({ type: VerificationRequiredDto })
  @ApiConflictResponse({
    description: 'Email or phone number is already registered',
  })
  @UseInterceptors(UploadInterceptor('image', 'image'))
  register(
    @Body() dto: RegisterDto,
    @UploadedFile() image?: TempFile,
  ): Promise<VerificationRequiredDto> {
    return this.authService.register(dto, image);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'Returns the token, or, while the email is not verified, `verificationRequired: true` (a new code is emailed unless one was sent in the last minute).',
  })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AuthResponseDto) },
        { $ref: getSchemaPath(VerificationRequiredDto) },
      ],
    },
  })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  login(
    @Body() dto: LoginDto,
  ): Promise<AuthResponseDto | VerificationRequiredDto> {
    return this.authService.login(dto);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify the email with the emailed code and log in',
    description: 'The code expires after 10 minutes or 5 wrong attempts.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({
    description: 'The code is incorrect, expired or used up too many attempts',
  })
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<AuthResponseDto> {
    return this.authService.verifyEmail(dto);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Email a new verification code',
    description:
      'At most one code a minute. Answers the same for unknown or already verified emails.',
  })
  @ApiOkResponse({ type: ResendVerificationResponseDto })
  @ApiTooManyRequestsResponse({
    description: 'A code was sent less than a minute ago',
  })
  resendVerification(
    @Body() dto: ResendVerificationDto,
  ): Promise<ResendVerificationResponseDto> {
    return this.authService.resendVerification(dto.email);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Email a password reset code',
    description:
      'Answers the same for unknown emails. At most one code a minute: asking again sooner sends nothing, the last code still works. Then call POST /auth/reset-password.',
  })
  @ApiOkResponse({ type: ResendVerificationResponseDto })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<ResendVerificationResponseDto> {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set a new password with the emailed reset code and log in',
    description:
      'The code expires after 10 minutes or 5 wrong attempts. Signs out every other session and marks the email verified.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({
    description: 'The code is incorrect, expired or used up too many attempts',
  })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<AuthResponseDto> {
    return this.authService.resetPassword(dto);
  }
}
