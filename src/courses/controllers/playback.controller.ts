import {
  Controller,
  Get,
  Header,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import { Permission } from '../../auth/constants/permissions.js';
import { PlaybackService } from '../services/playback.service.js';

@ApiTags('Playback')
@ApiBearerAuth()
@Controller('lessons')
export class PlaybackController {
  constructor(private readonly playback: PlaybackService) {}

  @Get(':id/playback')
  @RequirePermissions(Permission.COURSES_READ)
  // A signed URL must never be cached or reused after it expires.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Short-lived URL to watch a lesson video',
    description:
      'Checks enrollment, payment and lesson order, then returns the video URL (signed when PLAYBACK_SIGNING_SECRET is set) with its kind (hls or file) and expiry. Call again when it expires.',
  })
  @ApiQuery({ name: 'lang', enum: ['en', 'ar'], required: false })
  resolve(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Query('lang', new ParseEnumPipe(['en', 'ar'], { optional: true }))
    lang?: 'en' | 'ar',
  ) {
    return this.playback.resolve(id, user, lang);
  }
}
