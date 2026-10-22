import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  MAINTENANCE_INTERVAL_MS,
  PENDING_MAX_AGE_MS,
  STUCK_PROCESSING_MS,
} from '../media.constants.js';
import { MediaQueueService } from './media-queue.service.js';
import { MediaService } from './media.service.js';

// Housekeeping, run at startup and then hourly:
// - PROCESSING for over 30 minutes (the API died mid-job): back to UPLOADED and re-queued
// - PENDING for over 24 hours (the upload never happened): deleted
@Injectable()
export class MediaMaintenanceService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MediaMaintenanceService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly queue: MediaQueueService,
  ) {}

  // After every onModuleInit, so the queue is already started.
  async onApplicationBootstrap(): Promise<void> {
    await this.runOnce();
    this.timer = setInterval(
      () => void this.runOnce(),
      MAINTENANCE_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async runOnce(now: number = Date.now()): Promise<void> {
    try {
      await this.resetStuck(now);
      await this.deleteAbandoned(now);
    } catch (error) {
      this.logger.error(`Media maintenance failed: ${String(error)}`);
    }
  }

  private async resetStuck(now: number): Promise<void> {
    const stuck = await this.prisma.media.findMany({
      where: {
        status: 'processing',
        updatedAt: { lt: new Date(now - STUCK_PROCESSING_MS) },
      },
      select: { id: true },
    });
    for (const { id } of stuck) {
      await this.prisma.media.update({
        where: { id },
        data: { status: 'uploaded' },
      });
      await this.queue.enqueue(id);
    }
    if (stuck.length > 0) {
      this.logger.warn(`Re-queued ${stuck.length} stuck media item(s)`);
    }
  }

  private async deleteAbandoned(now: number): Promise<void> {
    const old = await this.prisma.media.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: new Date(now - PENDING_MAX_AGE_MS) },
      },
    });
    for (const media of old) await this.media.discard(media);
    if (old.length > 0) {
      this.logger.log(`Deleted ${old.length} abandoned upload(s)`);
    }
  }
}
