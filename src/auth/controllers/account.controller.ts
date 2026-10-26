import { Body, Controller, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../decorators/current-user.decorator.js';
import { AuthResponseDto } from '../dto/auth-response.dto.js';
import { ChangePasswordDto } from '../dto/change-credentials.dto.js';
import { AuthService } from '../services/auth.service.js';
import type { JwtPayload } from '../types/jwt-payload.js';

// Password change for the logged-in user. It lives next to login because it
// issues a new token; profile details are in UsersController. The email can't
// be changed: it identifies the account.
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
}
