import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { MailModule } from '../mail/mail.module.js';
import { MediaModule } from '../media/media.module.js';
import { UsersModule } from '../users/users.module.js';
import { AccountController } from './controllers/account.controller.js';
import { AuthController } from './controllers/auth.controller.js';
import { AuthService } from './services/auth.service.js';
import { EmailVerificationService } from './services/email-verification.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { PermissionsGuard } from './guards/permissions.guard.js';

@Module({
  imports: [
    UsersModule,
    MediaModule,
    MailModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret && process.env.NODE_ENV === 'production') {
          throw new Error('JWT_SECRET must be set in production');
        }
        return {
          secret: secret ?? 'dev-only-secret',
          signOptions: {
            expiresIn: (process.env.JWT_EXPIRES_IN ?? '1h') as StringValue,
          },
        };
      },
    }),
  ],
  controllers: [AuthController, AccountController],
  providers: [
    AuthService,
    EmailVerificationService,
    // Order matters: authenticate first, then check permissions.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AuthModule {}
