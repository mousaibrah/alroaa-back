import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { JwtPayload } from '../types/jwt-payload.js';

export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';

type SessionStatus =
  { kind: 'ok' } | { kind: 'ended' } | { kind: 'unverified'; email: string };

// Registered globally: every route requires a valid bearer token unless it is
// marked @Public(). Attaches the verified payload to `request.user`; on a
// public route that is best-effort, so `user` is undefined for guests.
// A token is also refused once its account is deleted, when it was issued
// before the last password change (that signs out other sessions), or while
// the email is unverified: that 401 carries `code: EMAIL_NOT_VERIFIED` and the
// email, so the frontend can log out and open the code screen.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      // A public route still works for a guest with a stale token.
      if (isPublic) return true;
      throw new UnauthorizedException('Invalid or expired token');
    }
    const status = await this.sessionStatus(payload);
    if (status.kind !== 'ok') {
      if (isPublic) return true;
      if (status.kind === 'unverified') {
        throw new UnauthorizedException({
          statusCode: 401,
          message: 'Email is not verified',
          code: EMAIL_NOT_VERIFIED,
          email: status.email,
        });
      }
      throw new UnauthorizedException('Session has ended, log in again');
    }
    request.user = payload;
    return true;
  }

  private async sessionStatus(payload: JwtPayload): Promise<SessionStatus> {
    const account = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        isDeleted: true,
        passwordChangedAt: true,
        emailVerifiedAt: true,
        email: true,
      },
    });
    if (!account || account.isDeleted) return { kind: 'ended' };
    if (account.passwordChangedAt) {
      // `iat` has second precision: a token issued in the same second as the
      // change (the one handed back by that request) still counts.
      const changedSec = Math.floor(account.passwordChangedAt.getTime() / 1000);
      if ((payload.iat ?? 0) < changedSec) return { kind: 'ended' };
    }
    if (!account.emailVerifiedAt) {
      return { kind: 'unverified', email: account.email };
    }
    return { kind: 'ok' };
  }
}
