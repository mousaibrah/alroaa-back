import type { MediaType } from '../generated/prisma/enums.js';

export const MEDIA_QUEUE = 'media-processing';

// Allowed uploads: MIME type -> media type and the file extension used in the
// storage key (the user's own filename is never used).
export const ALLOWED_MIME: Record<string, { type: MediaType; ext: string }> = {
  'image/jpeg': { type: 'image', ext: 'jpg' },
  'image/png': { type: 'image', ext: 'png' },
  'image/webp': { type: 'image', ext: 'webp' },
  'image/gif': { type: 'image', ext: 'gif' },
  'video/mp4': { type: 'video', ext: 'mp4' },
  'video/webm': { type: 'video', ext: 'webm' },
  'video/quicktime': { type: 'video', ext: 'mov' },
};

export const PRESIGN_PUT_TTL_SEC = 15 * 60;
// Multipart uploads: S3 needs parts of at least 5 MB and at most 10,000 parts.
export const MULTIPART_PART_SIZE = 16 * 1024 * 1024;
export const MULTIPART_MAX_PARTS = 10_000;
// Paid lesson videos are handed out for one hour.
export const PLAYBACK_GET_TTL_SEC = 60 * 60;
export const METADATA_GET_TTL_SEC = 15 * 60;

export const STUCK_PROCESSING_MS = 30 * 60 * 1000;
export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
