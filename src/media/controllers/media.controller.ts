import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '../../auth/constants/permissions.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { ListMediaQueryDto, PresignMediaDto } from '../dto/media.dto.js';
import { MediaService } from '../services/media.service.js';

// Admins and instructors only: they are the roles that hold courses.update.
@ApiTags('Media')
@ApiBearerAuth()
@RequirePermissions(Permission.COURSES_UPDATE)
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('presign')
  @ApiOperation({
    summary: 'Get a presigned URL to upload a file straight to storage',
    description:
      'PUT the file to `url` with the same Content-Type, then call POST /media/:id/confirm.',
  })
  presign(@CurrentUser() user: JwtPayload, @Body() dto: PresignMediaDto) {
    return this.media.presign(user, dto);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the upload and start processing' })
  confirm(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.media.confirm(id, user);
  }

  @Get()
  @ApiOperation({ summary: 'List your media (admins see all)' })
  list(@CurrentUser() user: JwtPayload, @Query() query: ListMediaQueryDto) {
    return this.media.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Media metadata and URLs' })
  get(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.get(id, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a media item and its files' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.media.remove(id, user);
  }
}
