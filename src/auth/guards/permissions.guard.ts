import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator.js';
import type { JwtPayload } from '../types/jwt-payload.js';
import type { Permission } from '../constants/permissions.js';

// Registered globally after JwtAuthGuard. Routes without @RequirePermissions
// only need to be authenticated.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>().user;
    const granted = new Set(user?.permissions ?? []);
    if (!required.every((permission) => granted.has(permission))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
