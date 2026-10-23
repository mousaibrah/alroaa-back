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
import {
  ListMediaQueryDto,
  MultipartPartDto,
  MultipartUploadDto,
  PresignMediaDto,
} from '../dto/media.dto.js';
import { MediaService } from '../services/media.service.js';

// Admins only: the only role that holds courses.update.
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

  @Post('multipart')
  @ApiOperation({
    summary: 'Start a multipart upload (large files)',
    description:
      'Upload the file in `partSize` chunks: sign each part with POST /media/:id/multipart/part, PUT the chunk to that URL, then call POST /media/:id/multipart/complete.',
  })
  startMultipart(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PresignMediaDto,
  ) {
    return this.media.startMultipart(user, dto);
  }

  @Post(':id/multipart/part')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a presigned URL for one part' })
  signPart(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MultipartPartDto,
  ) {
    return this.media.signPart(id, user, dto);
  }

  @Post(':id/multipart/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Join the parts, verify and start processing' })
  completeMultipart(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MultipartUploadDto,
  ) {
    return this.media.completeMultipart(id, user, dto.uploadId);
  }

  @Post(':id/multipart/abort')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a multipart upload and drop its parts' })
  abortMultipart(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MultipartUploadDto,
  ) {
    return this.media.abortMultipart(id, user, dto.uploadId);
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
