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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator.js';
import { AuthService } from '../services/auth.service.js';
import { AuthResponseDto } from '../dto/auth-response.dto.js';
import { LoginDto } from '../dto/login.dto.js';
import { RegisterDto, RegisterFormDto } from '../dto/register.dto.js';
import type { TempFile } from '../../media/services/media.service.js';
import { UploadInterceptor } from '../../media/utils/upload.interceptor.js';

@Public()
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'JSON, or multipart/form-data with an optional profile picture in `image`.',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: RegisterFormDto })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiConflictResponse({ description: 'Email is already registered' })
  @UseInterceptors(UploadInterceptor('image', 'image'))
  register(
    @Body() dto: RegisterDto,
    @UploadedFile() image?: TempFile,
  ): Promise<AuthResponseDto> {
    return this.authService.register(dto, image);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }
}
