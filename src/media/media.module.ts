import { Module } from '@nestjs/common';
import { MediaController } from './controllers/media.controller.js';
import { MediaMaintenanceService } from './services/media-maintenance.service.js';
import { MediaProcessorService } from './services/media-processor.service.js';
import { MediaQueueService } from './services/media-queue.service.js';
import { MediaService } from './services/media.service.js';
import { StorageService } from './services/storage.service.js';

@Module({
  controllers: [MediaController],
  providers: [
    StorageService,
    MediaService,
    MediaProcessorService,
    MediaQueueService,
    MediaMaintenanceService,
  ],
  exports: [MediaService],
})
export class MediaModule {}
