import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import type { MailService } from '../../mail/mail.service.js';
import type { MediaService } from '../../media/services/media.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { UsersService } from '../../users/services/users.service.js';
import type { User } from '../../users/types/user.entity.js';
import { AuthService } from '../services/auth.service.js';
import { EmailVerificationService } from '../services/email-verification.service.js';

const user = { id: 7, email: 'me@x.com', firstName: 'Sam' } as User;
const hash = (code: string) =>
  createHash('sha256').update(`7:${code}`).digest('hex');

const makeService = (pending: object | null = null) => {
  const prisma = {
    emailVerificationCode: {
      findUnique: vi.fn().mockResolvedValue(pending),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({}),
    },
    user: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn().mockResolvedValue([]),
  };
  const mail = {
    from: 'no-reply@x.com',
    send: vi.fn().mockResolvedValue(undefined),
  };
  const service = new EmailVerificationService(
    prisma as unknown as PrismaService,
    mail as unknown as MailService,
  );
  return { service, prisma, mail };
};

describe('EmailVerificationService', () => {
  it('emails a 6-digit code and stores only its hash', async () => {
    const { service, prisma, mail } = makeService();
    expect(await service.send(user)).toBe(60);
    const text: string = mail.send.mock.calls[0][0].text;
    const code = /: (\d{6})/.exec(text)![1];
    const stored = prisma.emailVerificationCode.upsert.mock.calls[0][0].create;
    expect(stored.codeHash).toBe(hash(code));
    expect(JSON.stringify(stored)).not.toContain(`"${code}"`);
  });

  it('answers without waiting for the email', async () => {
    const { service, mail } = makeService();
    mail.send.mockReturnValue(new Promise(() => undefined)); // never finishes
    await expect(service.send(user)).resolves.toBe(60);
  });

  it('in production, reports a failed resend and lifts the cooldown', async () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { service, prisma, mail } = makeService();
      mail.send.mockRejectedValue(new Error('smtp down'));
      await expect(service.resend(user)).rejects.toThrow(
        'Could not send the verification code',
      );
      expect(prisma.emailVerificationCode.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { sentAt: new Date(0) } }),
      );
    } finally {
      process.env.NODE_ENV = env;
    }
  });

  it('does not send again within the cooldown', async () => {
    const { service, mail } = makeService({
      sentAt: new Date(Date.now() - 20_000),
    });
    const wait = await service.send(user);
    expect(wait).toBeGreaterThan(35);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('asks to wait when resending too soon', async () => {
    const { service } = makeService({ sentAt: new Date() });
    await expect(service.resend(user)).rejects.toBeInstanceOf(HttpException);
  });

  it('verifies the right code and deletes it', async () => {
    const { service, prisma } = makeService({
      codeHash: hash('123456'),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
    });
    await service.verify(user, '123456');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { emailVerifiedAt: expect.any(Date) },
    });
    expect(prisma.emailVerificationCode.deleteMany).toHaveBeenCalledWith({
      where: { userId: 7 },
    });
  });

  it('counts a wrong code', async () => {
    const { service, prisma } = makeService({
      codeHash: hash('123456'),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
    });
    await expect(service.verify(user, '000000')).rejects.toThrow('incorrect');
    expect(prisma.emailVerificationCode.update).toHaveBeenCalledWith({
      where: { userId: 7 },
      data: { attempts: { increment: 1 } },
    });
  });

  it('refuses an expired code', async () => {
    const { service } = makeService({
      codeHash: hash('123456'),
      expiresAt: new Date(Date.now() - 1),
      attempts: 0,
    });
    await expect(service.verify(user, '123456')).rejects.toThrow('expired');
  });

  it('refuses after too many wrong attempts, even the right code', async () => {
    const { service } = makeService({
      codeHash: hash('123456'),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 5,
    });
    await expect(service.verify(user, '123456')).rejects.toThrow('Too many');
  });
});

describe('AuthService login and verification', () => {
  const make = async (emailVerifiedAt: Date | null) => {
    const account = {
      id: 7,
      email: 'me@x.com',
      password: await bcrypt.hash('Pass12345', 4),
      roleId: 2,
      emailVerifiedAt,
    };
    const users = {
      findByEmail: vi.fn().mockResolvedValue(account),
      findAccessByRoleId: vi
        .fn()
        .mockResolvedValue({ role: 'user', permissions: [] }),
    };
    const verification = {
      send: vi.fn().mockResolvedValue(60),
      resend: vi.fn().mockResolvedValue(60),
      verify: vi.fn().mockResolvedValue(undefined),
    };
    const service = new AuthService(
      users as unknown as UsersService,
      {
        signAsync: vi.fn().mockResolvedValue('token'),
      } as unknown as JwtService,
      {} as MediaService,
      verification as unknown as EmailVerificationService,
    );
    return { service, users, verification };
  };

  it('sends a code instead of a token while unverified', async () => {
    const { service, verification } = await make(null);
    const out = await service.login({
      email: 'Me@x.com',
      password: 'Pass12345',
    });
    expect(out).toEqual({
      verificationRequired: true,
      email: 'me@x.com',
      resendAvailableIn: 60,
    });
    expect(verification.send).toHaveBeenCalled();
  });

  it('checks the password before saying anything about verification', async () => {
    const { service, verification } = await make(null);
    await expect(
      service.login({ email: 'me@x.com', password: 'wrong' }),
    ).rejects.toThrow('Invalid email or password');
    expect(verification.send).not.toHaveBeenCalled();
  });

  it('logs in a verified account', async () => {
    const { service } = await make(new Date());
    const out = await service.login({
      email: 'me@x.com',
      password: 'Pass12345',
    });
    expect(out).toMatchObject({ accessToken: 'token' });
  });

  it('returns a token once the code is verified', async () => {
    const { service, verification } = await make(null);
    const out = await service.verifyEmail({
      email: 'me@x.com',
      code: '123456',
    });
    expect(verification.verify).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      '123456',
    );
    expect(out.accessToken).toBe('token');
  });

  it('answers resend the same way for an unknown email', async () => {
    const { service, users, verification } = await make(null);
    users.findByEmail.mockResolvedValue(undefined);
    expect(await service.resendVerification('nobody@x.com')).toEqual({
      resendAvailableIn: 60,
    });
    expect(verification.resend).not.toHaveBeenCalled();
  });
});
