import { tmpdir } from 'node:os';
import { FileInterceptor } from '@nestjs/platform-express';
import { sizeLimits } from '../../media/utils/media.util.js';

// The lesson file in a multipart body (field `file`). It is written to a temp
// file (videos can be large) and the per-type size limit is checked when
// storing it.
export const LessonFileInterceptor = () =>
  FileInterceptor('file', {
    dest: tmpdir(),
    limits: { fileSize: Math.max(...Object.values(sizeLimits())) },
  });
