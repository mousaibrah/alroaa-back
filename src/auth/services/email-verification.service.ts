import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MailService } from '../../mail/mail.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { User } from '../../users/types/user.entity.js';

export const CODE_TTL_MIN = 10;
export const RESEND_COOLDOWN_SEC = 60;
export const MAX_ATTEMPTS = 5;

const hashCode = (userId: number, code: string) =>
  createHash('sha256').update(`${userId}:${code}`).digest('hex');

// One 6-digit code per account at a time. Only its hash is stored; it expires
// after CODE_TTL_MIN minutes or MAX_ATTEMPTS wrong guesses.
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // Emails a new code unless one went out less than RESEND_COOLDOWN_SEC ago.
  // Returns the seconds until the next one may be requested. Doesn't wait for
  // the email itself (SMTP takes 1-2s), so register and login answer quickly.
  // `isNewAccount` skips the cooldown lookup: a new account has no code yet.
  async send(user: User, isNewAccount = false): Promise<number> {
    const wait = isNewAccount ? 0 : await this.cooldownLeft(user.id);
    if (wait > 0) return wait;
    await this.issue(user, false);
    return RESEND_COOLDOWN_SEC;
  }

  // Like `send`, but asks the caller to wait instead of returning silently,
  // and waits for the email so a failure is reported.
  async resend(user: User): Promise<number> {
    const wait = await this.cooldownLeft(user.id);
    if (wait > 0) {
      throw new HttpException(
        `Please wait ${wait} seconds before requesting a new code`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.issue(user, true);
    return RESEND_COOLDOWN_SEC;
  }

  // Stores the new code first, so it works as soon as the email arrives.
  private async issue(user: User, waitForEmail: boolean): Promise<void> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const data = {
      codeHash: hashCode(user.id, code),
      expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60_000),
      attempts: 0,
      sentAt: new Date(),
    };
    await this.prisma.emailVerificationCode.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });

    const delivery = this.deliver(user, code, data.codeHash);
    if (waitForEmail) await delivery;
    else delivery.catch(() => undefined); // already logged
  }

  private async deliver(
    user: User,
    code: string,
    codeHash: string,
  ): Promise<void> {
    try {
      await this.mail.send({
        from: `"Alroaa" <${this.mail.from}>`,
        to: user.email,
        subject: 'رمز التحقق | Verification code',
        text: verificationText(user.firstName, code),
        html: verificationHtml(user.firstName, code),
      });
    } catch (err) {
      this.logger.error(
        `Failed to send the code to user ${user.id}`,
        err as Error,
      );
      // Lets a developer without SMTP credentials still verify.
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          `Dev only: verification code for ${user.email} is ${code}`,
        );
        return;
      }
      // The code never arrived: allow asking for a new one right away.
      await this.prisma.emailVerificationCode
        .updateMany({
          where: { userId: user.id, codeHash },
          data: { sentAt: new Date(0) },
        })
        .catch(() => undefined);
      throw new ServiceUnavailableException(
        'Could not send the verification code, please try again later',
      );
    }
  }

  // Checks the code and marks the email verified (the code is then deleted).
  async verify(user: User, code: string): Promise<void> {
    const pending = await this.prisma.emailVerificationCode.findUnique({
      where: { userId: user.id },
    });
    if (!pending || pending.expiresAt <= new Date()) {
      throw new BadRequestException('The code has expired, request a new one');
    }
    if (pending.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException(
        'Too many wrong attempts, request a new code',
      );
    }

    const expected = Buffer.from(pending.codeHash, 'hex');
    const given = Buffer.from(hashCode(user.id, code), 'hex');
    if (!timingSafeEqual(expected, given)) {
      await this.prisma.emailVerificationCode.update({
        where: { userId: user.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('The code is incorrect');
    }

    // Run together rather than in a transaction (4 round trips to the
    // database): a leftover code is harmless once the email is verified.
    await Promise.all([
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.emailVerificationCode.deleteMany({
        where: { userId: user.id },
      }),
    ]);
  }

  private async cooldownLeft(userId: number): Promise<number> {
    const pending = await this.prisma.emailVerificationCode.findUnique({
      where: { userId },
      select: { sentAt: true },
    });
    if (!pending) return 0;
    const elapsed = (Date.now() - pending.sentAt.getTime()) / 1000;
    return Math.max(0, Math.ceil(RESEND_COOLDOWN_SEC - elapsed));
  }
}

const verificationText = (name: string, code: string) =>
  [
    `مرحباً ${name}،`,
    `رمز التحقق من بريدك الإلكتروني هو: ${code}`,
    `ينتهي الرمز خلال ${CODE_TTL_MIN} دقائق.`,
    '',
    `Hello ${name},`,
    `Your email verification code is: ${code}`,
    `It expires in ${CODE_TTL_MIN} minutes.`,
    '',
    "If you didn't create an account, ignore this email.",
  ].join('\n');

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        ch
      ]!,
  );

const verificationHtml = (name: string, code: string) => {
  const safeName = escapeHtml(name);
  const codeBlock = `<p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:16px 0;direction:ltr">${code}</p>`;
  return `<div style="font-family:Arial,sans-serif;color:#1f2937;max-width:480px">
  <div dir="rtl" style="text-align:right">
    <p>مرحباً ${safeName}،</p>
    <p>رمز التحقق من بريدك الإلكتروني هو:</p>
    ${codeBlock}
    <p>ينتهي الرمز خلال ${CODE_TTL_MIN} دقائق.</p>
  </div>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
  <div dir="ltr" style="text-align:left">
    <p>Hello ${safeName},</p>
    <p>Your email verification code is:</p>
    ${codeBlock}
    <p>It expires in ${CODE_TTL_MIN} minutes.</p>
    <p style="color:#6b7280;font-size:12px">If you didn't create an account, ignore this email.</p>
  </div>
</div>`;
};
