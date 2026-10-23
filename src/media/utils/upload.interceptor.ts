import { tmpdir } from 'node:os';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
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

// Several single-file fields (e.g. a course's cover and intro video). Each
// file's type and size are checked when it is stored.
export const UploadFieldsInterceptor = (...fields: string[]) =>
  FileFieldsInterceptor(
    fields.map((name) => ({ name, maxCount: 1 })),
    {
      dest: tmpdir(),
      limits: { fileSize: Math.max(...Object.values(sizeLimits())) },
    },
  );
