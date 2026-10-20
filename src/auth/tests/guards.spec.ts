import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator.js';
import { JwtAuthGuard } from '../guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../guards/permissions.guard.js';

const makeContext = (request: object): ExecutionContext => {
  const handler = () => undefined;
  class Controller {}
  return {
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

const reflectorFor = (metadata: Record<string, unknown>) =>
  ({
    getAllAndOverride: (key: string) => metadata[key],
  }) as unknown as Reflector;

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({ secret: 'test-secret' });

  it('lets @Public routes through without a token', async () => {
    const guard = new JwtAuthGuard(
      jwt,
      reflectorFor({ [IS_PUBLIC_KEY]: true }),
    );
    await expect(guard.canActivate(makeContext({ headers: {} }))).resolves.toBe(
      true,
    );
  });

  it('rejects a missing token', async () => {
    const guard = new JwtAuthGuard(jwt, reflectorFor({}));
    await expect(
      guard.canActivate(makeContext({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed with another secret', async () => {
    const forged = await new JwtService({ secret: 'other' }).signAsync({
      sub: 1,
    });
    const guard = new JwtAuthGuard(jwt, reflectorFor({}));
    await expect(
      guard.canActivate(
        makeContext({ headers: { authorization: `Bearer ${forged}` } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the payload for a valid token', async () => {
    const token = await jwt.signAsync({
      sub: 1,
      permissions: ['courses.read'],
    });
    const request: { headers: object; user?: { sub: number } } = {
      headers: { authorization: `Bearer ${token}` },
    };
    const guard = new JwtAuthGuard(jwt, reflectorFor({}));
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user?.sub).toBe(1);
  });
});

describe('PermissionsGuard', () => {
  it('allows routes with no required permissions', () => {
    const guard = new PermissionsGuard(reflectorFor({}));
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });

  it('allows when the user holds all required permissions', () => {
    const guard = new PermissionsGuard(
      reflectorFor({ [PERMISSIONS_KEY]: ['courses.read', 'courses.create'] }),
    );
    const request = {
      user: { permissions: ['courses.read', 'courses.create', 'x'] },
    };
    expect(guard.canActivate(makeContext(request))).toBe(true);
  });

  it('forbids when one required permission is missing', () => {
    const guard = new PermissionsGuard(
      reflectorFor({ [PERMISSIONS_KEY]: ['courses.read', 'courses.delete'] }),
    );
    const request = { user: { permissions: ['courses.read'] } };
    expect(() => guard.canActivate(makeContext(request))).toThrow(
      ForbiddenException,
    );
  });

  it('forbids when there is no user', () => {
    const guard = new PermissionsGuard(
      reflectorFor({ [PERMISSIONS_KEY]: ['courses.read'] }),
    );
    expect(() => guard.canActivate(makeContext({}))).toThrow(
      ForbiddenException,
    );
  });
});
