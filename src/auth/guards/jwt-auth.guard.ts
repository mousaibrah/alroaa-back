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

// Registered globally: every route requires a valid bearer token unless it is
// marked @Public(). Attaches the verified payload to `request.user`; on a
// public route that is best-effort, so `user` is undefined for guests.
// A token is also refused once its account is deleted, or when it was issued
// before the last password change (that signs out other sessions).
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
    if (!(await this.isCurrent(payload))) {
      if (isPublic) return true;
      throw new UnauthorizedException('Session has ended, log in again');
    }
    request.user = payload;
    return true;
  }

  private async isCurrent(payload: JwtPayload): Promise<boolean> {
    const account = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isDeleted: true, passwordChangedAt: true },
    });
    if (!account || account.isDeleted) return false;
    if (!account.passwordChangedAt) return true;
    // `iat` has second precision: a token issued in the same second as the
    // change (the one handed back by that request) still counts.
    const changedSec = Math.floor(account.passwordChangedAt.getTime() / 1000);
    return (payload.iat ?? 0) >= changedSec;
  }
}
