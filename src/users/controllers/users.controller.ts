import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import type { TempFile } from '../../media/services/media.service.js';
import { UploadInterceptor } from '../../media/utils/upload.interceptor.js';
import { UpdateProfileDto } from '../dto/update-profile.dto.js';
import { UserDto } from '../dto/user.dto.js';
import { UsersService } from '../services/users.service.js';

// Any logged-in user, for their own account.
@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Your account' })
  @ApiOkResponse({ type: UserDto })
  async me(@CurrentUser() user: JwtPayload): Promise<UserDto> {
    return UserDto.from(await this.users.findById(user.sub));
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update your name, gender, date of birth or phone number',
    description:
      'Email and password are changed through PATCH /users/me/email and PUT /users/me/password, which ask for the current password.',
  })
  @ApiOkResponse({ type: UserDto })
  @ApiConflictResponse({
    description: 'Phone number is already registered',
  })
  async updateMe(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserDto> {
    return UserDto.from(await this.users.updateProfile(user.sub, dto));
  }

  @Put('me/image')
  @ApiOperation({
    summary: 'Upload or replace your profile picture',
    description:
      'multipart/form-data with the picture in `image` (jpeg, png, webp, gif). `image` in the response is its URL; it switches to a 320px copy once processed.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: { image: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: UserDto })
  @UseInterceptors(UploadInterceptor('image', 'image'))
  async updateImage(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() image?: TempFile,
  ): Promise<UserDto> {
    if (!image) {
      throw new BadRequestException('Send the picture in the `image` field');
    }
    return UserDto.from(await this.users.updateImage(user, image));
  }
}
