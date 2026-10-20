import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { PlaybackKind, PlaybackSource } from '../types/playback.types.js';

const DEFAULT_TTL_SEC = 900;

const isHls = (url: string): boolean => {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.m3u8');
  } catch {
    return url.toLowerCase().split('?')[0].endsWith('.m3u8');
  }
};

// Turns a stored video address into one the browser may use for a short time.
//
// With PLAYBACK_SIGNING_SECRET set, `expires` (unix seconds) and `sig` are added
// to the URL, where
//   sig = hex( HMAC-SHA256(secret, `${pathname}\n${expires}`) )
// and the CDN / media server in front of the private storage must recompute the
// signature and reject expired or wrong ones. Without the secret the stored URL
// is returned as is (fine for development and public placeholder videos).
@Injectable()
export class PlaybackUrlService {
  private readonly logger = new Logger(PlaybackUrlService.name);

  constructor() {
    if (process.env.NODE_ENV === 'production' && !this.secret()) {
      this.logger.warn(
        'PLAYBACK_SIGNING_SECRET is not set: video URLs are returned unsigned.',
      );
    }
  }

  private secret(): string | undefined {
    return process.env.PLAYBACK_SIGNING_SECRET || undefined;
  }

  private ttlSec(): number {
    const ttl = Number(process.env.PLAYBACK_URL_TTL_SEC);
    return Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : DEFAULT_TTL_SEC;
  }

  sign(rawUrl: string, now: number = Date.now()): PlaybackSource {
    const kind: PlaybackKind = isHls(rawUrl) ? 'hls' : 'file';
    const secret = this.secret();
    if (!secret) return { url: rawUrl, kind, expiresAt: null };

    const expires = Math.floor(now / 1000) + this.ttlSec();
    const url = new URL(rawUrl);
    const sig = createHmac('sha256', secret)
      .update(`${url.pathname}\n${expires}`)
      .digest('hex');
    url.searchParams.set('expires', String(expires));
    url.searchParams.set('sig', sig);
    return {
      url: url.toString(),
      kind,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }
}
