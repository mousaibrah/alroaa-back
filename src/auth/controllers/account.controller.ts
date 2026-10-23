import { Body, Controller, Patch, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../decorators/current-user.decorator.js';
import { AuthResponseDto } from '../dto/auth-response.dto.js';
import {
  ChangeEmailDto,
  ChangePasswordDto,
} from '../dto/change-credentials.dto.js';
import { AuthService } from '../services/auth.service.js';
import type { JwtPayload } from '../types/jwt-payload.js';

// Credential changes for the logged-in user. They live next to login because
// they issue a new token; profile details are in UsersController.
@ApiTags('Users')
@ApiBearerAuth()
@Controller('users/me')
export class AccountController {
  constructor(private readonly auth: AuthService) {}

  @Put('password')
  @ApiOperation({
    summary: 'Change your password',
    description:
      'Needs the current password. Signs out every other session; use the returned token from now on.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiForbiddenResponse({ description: 'Current password is incorrect' })
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ): Promise<AuthResponseDto> {
    return this.auth.changePassword(user, dto);
  }

  @Patch('email')
  @ApiOperation({
    summary: 'Change your email',
    description:
      'Needs the current password. Signs out every other session; use the returned token from now on.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiForbiddenResponse({ description: 'Current password is incorrect' })
  @ApiConflictResponse({ description: 'Email is already registered' })
  changeEmail(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangeEmailDto,
  ): Promise<AuthResponseDto> {
    return this.auth.changeEmail(user, dto);
  }
}
