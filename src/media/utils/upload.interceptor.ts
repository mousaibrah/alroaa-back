import { tmpdir } from 'node:os';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MediaType } from '../../generated/prisma/enums.js';
import { sizeLimits } from './media.util.js';

// One file in a multipart body (lesson content, course cover). It is written to
// a temp file (videos can be large); the type is checked when it is stored.
export const UploadInterceptor = (field: string, type?: MediaType) =>
  FileInterceptor(field, {
    dest: tmpdir(),
    limits: {
      fileSize: type
        ? sizeLimits()[type]
        : Math.max(...Object.values(sizeLimits())),
    },
  });
