import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { MEDIA_QUEUE } from '../media.constants.js';
import { pgBossConnectionString } from '../utils/media.util.js';
import { MediaProcessorService } from './media-processor.service.js';

const RETRY_LIMIT = 3;

interface MediaJob {
  mediaId: string;
}

// pg-boss on the same PostgreSQL database (its own `pgboss` schema). The worker
// runs inside the API process; it can move to its own process later.
@Injectable()
export class MediaQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaQueueService.name);
  private boss?: PgBoss;

  constructor(private readonly processor: MediaProcessorService) {}

  async onModuleInit(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is not set');
    const boss = new PgBoss({
      connectionString: pgBossConnectionString(databaseUrl),
      schema: 'pgboss',
    });
    boss.on('error', (error) => this.logger.error(`pg-boss: ${String(error)}`));
    await boss.start();
    await boss.createQueue(MEDIA_QUEUE, {
      retryLimit: RETRY_LIMIT,
      retryDelay: 30,
      retryBackoff: true,
    });
    const concurrency = Math.min(
      2,
      Math.max(1, Number(process.env.MEDIA_WORKER_CONCURRENCY) || 1),
    );
    await boss.work<MediaJob>(
      MEDIA_QUEUE,
      { batchSize: 1, localConcurrency: concurrency, includeMetadata: true },
      async (jobs) => {
        for (const job of jobs) {
          await this.processor.process(
            job.data.mediaId,
            job.retryCount >= RETRY_LIMIT,
          );
        }
      },
    );
    this.boss = boss;
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss?.stop({ graceful: true, timeout: 10_000 });
  }

  async enqueue(mediaId: string): Promise<void> {
    if (!this.boss) throw new Error('Media queue is not started');
    await this.boss.send(MEDIA_QUEUE, { mediaId } satisfies MediaJob);
  }
}
