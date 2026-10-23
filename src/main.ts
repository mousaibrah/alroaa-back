import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { UPLOAD_PAGE } from './media/dev/upload-page.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Payment webhooks are verified against the exact bytes received.
    rawBody: true,
  });
  // Browser frontends (e.g. the Vite dev server) need CORS to call the API.
  // CORS_ORIGIN accepts a comma-separated list.
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Dev-only file picker for the presign -> PUT -> confirm flow.
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    app
      .getHttpAdapter()
      .get(
        '/upload-test',
        (
          _req: unknown,
          res: { type: (t: string) => { send: (b: string) => void } },
        ) => res.type('html').send(UPLOAD_PAGE),
      );
  }

  const config = new DocumentBuilder()
    .setTitle('Alroaa API')
    .setDescription(
      isDev
        ? 'Courses platform API. To try media uploads with a file picker, open /upload-test (dev only).'
        : 'Courses platform API',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  // Node closes requests after 5 minutes by default, which aborts large video
  // uploads on slow connections. UPLOAD_TIMEOUT_MIN raises that (default 60).
  const server = app.getHttpServer();
  server.requestTimeout = Number(process.env.UPLOAD_TIMEOUT_MIN ?? 60) * 60_000;

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
await bootstrap();
