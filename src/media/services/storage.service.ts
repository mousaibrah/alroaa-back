import { Readable } from 'node:stream';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { allowedOrigins } from '../utils/media.util.js';
import { PRESIGN_PUT_TTL_SEC } from '../media.constants.js';

const env = (name: string, fallback: string): string =>
  process.env[name] || fallback;

// S3-compatible storage (RustFS locally). Two clients: S3_ENDPOINT is how the
// server reaches the storage; S3_PUBLIC_ENDPOINT is the host the browser sees,
// and is what presigned URLs are signed for.
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket = env('S3_BUCKET', 'alroaa');
  private readonly internal: S3Client;
  private readonly signer: S3Client;

  constructor() {
    const endpoint = env('S3_ENDPOINT', 'http://127.0.0.1:9000');
    const config = (url: string) => ({
      endpoint: url,
      region: env('S3_REGION', 'us-east-1'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: env('S3_ACCESS_KEY', ''),
        secretAccessKey: env('S3_SECRET_KEY', ''),
      },
    });
    this.internal = new S3Client(config(endpoint));
    this.signer = new S3Client(config(env('S3_PUBLIC_ENDPOINT', endpoint)));
  }

  // Storage being down must not stop the API from booting: log and carry on.
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBucket();
    } catch (error) {
      this.logger.error(
        `Could not reach storage at ${env('S3_ENDPOINT', 'http://127.0.0.1:9000')}: ${String(error)}`,
      );
      return;
    }
    await this.applyCors();
    await this.applyPublicReadPolicy();
  }

  private async ensureBucket(): Promise<void> {
    try {
      await this.internal.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.internal.send(
        new CreateBucketCommand({ Bucket: this.bucket }),
      );
      this.logger.log(`Created bucket "${this.bucket}"`);
    }
  }

  private async applyCors(): Promise<void> {
    try {
      await this.internal.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: allowedOrigins(),
                AllowedMethods: ['PUT', 'GET', 'HEAD'],
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Could not apply bucket CORS (browser uploads may be blocked): ${String(error)}. See docs/UPLOADS.md.`,
      );
    }
  }

  // Public files (media/*) are readable by anyone; private/* is not.
  private async applyPublicReadPolicy(): Promise<void> {
    try {
      await this.internal.send(
        new PutBucketPolicyCommand({
          Bucket: this.bucket,
          Policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: '*',
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${this.bucket}/media/*`],
              },
            ],
          }),
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Could not apply the public-read bucket policy (public URLs may return 403): ${String(error)}. See docs/UPLOADS.md.`,
      );
    }
  }

  createPresignedPutUrl(
    key: string,
    contentType: string,
    contentLength: number,
    expiresIn = PRESIGN_PUT_TTL_SEC,
  ): Promise<string> {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      {
        expiresIn,
        // Sign both, so the browser cannot send another type or size.
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
  }

  createPresignedGetUrl(key: string, expiresIn: number): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  getPublicUrl(key: string): string {
    const base =
      process.env.S3_PUBLIC_BASE_URL ||
      `${env('S3_PUBLIC_ENDPOINT', env('S3_ENDPOINT', 'http://127.0.0.1:9000'))}/${this.bucket}`;
    return `${base.replace(/\/$/, '')}/${key}`;
  }

  // null when the object does not exist.
  async headObject(
    key: string,
  ): Promise<{ size: number; contentType: string | undefined } | null> {
    try {
      const head = await this.internal.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: head.ContentLength ?? 0, contentType: head.ContentType };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  async getObjectStream(key: string): Promise<Readable> {
    const out = await this.internal.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return out.Body as Readable;
  }

  // For variants: a stream needs its length up front (S3 does not accept
  // chunked bodies on a plain PutObject).
  async putObject(
    key: string,
    body: Readable | Buffer,
    contentType: string,
    contentLength: number,
  ): Promise<void> {
    await this.internal.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
    );
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.internal.send(
      new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
}
