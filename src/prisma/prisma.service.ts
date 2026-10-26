import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

// Requests often run a few queries at once (the auth guard, then parallel
// lookups), so a few open connections avoid most connection setup.
const WARM_CONNECTIONS = 3;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set (see .env.example)');
    }
    super({
      adapter: new PrismaPg({
        connectionString,
        // Opening a connection to the database server takes 0.5-0.9s, so keep
        // idle ones open for 10 minutes instead of pg's 30 seconds, and never
        // close the last WARM_CONNECTIONS.
        idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 600_000),
        min: WARM_CONNECTIONS,
        keepAlive: true,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // Opens the warm connections now (queries run in parallel each take
    // their own), so the first requests don't wait for them.
    await Promise.all(
      Array.from({ length: WARM_CONNECTIONS }, () => this.$queryRaw`SELECT 1`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
