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

// What a code is for. An account can have one of each pending.
export type CodePurpose = 'verify_email' | 'reset_password';

const hashCode = (userId: number, code: string) =>
  createHash('sha256').update(`${userId}:${code}`).digest('hex');

// One 6-digit code per account and purpose at a time. Only its hash is
// stored; it expires after CODE_TTL_MIN minutes or MAX_ATTEMPTS wrong guesses.
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
  async send(
    user: User,
    purpose: CodePurpose,
    isNewAccount = false,
  ): Promise<number> {
    const wait = isNewAccount ? 0 : await this.cooldownLeft(user.id, purpose);
    if (wait > 0) return wait;
    await this.issue(user, purpose, false);
    return RESEND_COOLDOWN_SEC;
  }

  // Like `send`, but asks the caller to wait instead of returning silently,
  // and waits for the email so a failure is reported.
  async resend(user: User, purpose: CodePurpose): Promise<number> {
    const wait = await this.cooldownLeft(user.id, purpose);
    if (wait > 0) {
      throw new HttpException(
        `Please wait ${wait} seconds before requesting a new code`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.issue(user, purpose, true);
    return RESEND_COOLDOWN_SEC;
  }

  // Stores the new code first, so it works as soon as the email arrives.
  private async issue(
    user: User,
    purpose: CodePurpose,
    waitForEmail: boolean,
  ): Promise<void> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const data = {
      codeHash: hashCode(user.id, code),
      expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60_000),
      attempts: 0,
      sentAt: new Date(),
    };
    await this.prisma.emailVerificationCode.upsert({
      where: { userId_purpose: { userId: user.id, purpose } },
      create: { userId: user.id, purpose, ...data },
      update: data,
    });

    const delivery = this.deliver(user, purpose, code, data.codeHash);
    if (waitForEmail) await delivery;
    else delivery.catch(() => undefined); // already logged
  }

  private async deliver(
    user: User,
    purpose: CodePurpose,
    code: string,
    codeHash: string,
  ): Promise<void> {
    const copy = EMAIL_COPY[purpose];
    try {
      await this.mail.send({
        from: `"Alroaa" <${this.mail.from}>`,
        to: user.email,
        subject: copy.subject,
        text: codeText(copy, user.firstName, code),
        html: codeHtml(copy, user.firstName, code),
      });
    } catch (err) {
      this.logger.error(
        `Failed to send the code to user ${user.id}`,
        err as Error,
      );
      // Lets a developer without SMTP credentials still enter the code.
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          `Dev only: ${purpose} code for ${user.email} is ${code}`,
        );
        return;
      }
      // The code never arrived: allow asking for a new one right away.
      await this.prisma.emailVerificationCode
        .updateMany({
          where: { userId: user.id, purpose, codeHash },
          data: { sentAt: new Date(0) },
        })
        .catch(() => undefined);
      throw new ServiceUnavailableException(
        'Could not send the code, please try again later',
      );
    }
  }

  // Checks the code and marks the email verified (the code is then deleted).
  async verify(user: User, code: string): Promise<void> {
    await this.check(user, 'verify_email', code);
    // Run together rather than in a transaction (4 round trips to the
    // database): a leftover code is harmless once the email is verified.
    await Promise.all([
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.emailVerificationCode.deleteMany({
        where: { userId: user.id, purpose: 'verify_email' },
      }),
    ]);
  }

  // Checks the reset code and sets the new password (already hashed), which
  // signs out every session. The code reached the inbox, so the email counts
  // as verified too, and every pending code of the account is deleted.
  async resetPassword(
    user: User,
    code: string,
    passwordHash: string,
  ): Promise<void> {
    await this.check(user, 'reset_password', code);
    const now = new Date();
    await Promise.all([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          password: passwordHash,
          passwordChangedAt: now,
          emailVerifiedAt: user.emailVerifiedAt ?? now,
        },
      }),
      this.prisma.emailVerificationCode.deleteMany({
        where: { userId: user.id },
      }),
    ]);
  }

  // Throws unless `code` is the pending one; a wrong guess is counted.
  private async check(
    user: User,
    purpose: CodePurpose,
    code: string,
  ): Promise<void> {
    const where = { userId_purpose: { userId: user.id, purpose } };
    const pending = await this.prisma.emailVerificationCode.findUnique({
      where,
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
        where,
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('The code is incorrect');
    }
  }

  private async cooldownLeft(
    userId: number,
    purpose: CodePurpose,
  ): Promise<number> {
    const pending = await this.prisma.emailVerificationCode.findUnique({
      where: { userId_purpose: { userId, purpose } },
      select: { sentAt: true },
    });
    if (!pending) return 0;
    const elapsed = (Date.now() - pending.sentAt.getTime()) / 1000;
    return Math.max(0, Math.ceil(RESEND_COOLDOWN_SEC - elapsed));
  }
}

interface EmailCopy {
  subject: string;
  // The line before the code, and the note under it.
  introAr: string;
  introEn: string;
  ignoreEn: string;
}

const EMAIL_COPY: Record<CodePurpose, EmailCopy> = {
  verify_email: {
    subject: 'رمز التحقق | Verification code',
    introAr: 'رمز التحقق من بريدك الإلكتروني هو',
    introEn: 'Your email verification code is',
    ignoreEn: "If you didn't create an account, ignore this email.",
  },
  reset_password: {
    subject: 'إعادة تعيين كلمة المرور | Password reset',
    introAr: 'رمز إعادة تعيين كلمة المرور هو',
    introEn: 'Your password reset code is',
    ignoreEn:
      "If you didn't ask to reset your password, ignore this email: your password stays the same.",
  },
};

const codeText = (copy: EmailCopy, name: string, code: string) =>
  [
    `مرحباً ${name}،`,
    `${copy.introAr}: ${code}`,
    `ينتهي الرمز خلال ${CODE_TTL_MIN} دقائق.`,
    '',
    `Hello ${name},`,
    `${copy.introEn}: ${code}`,
    `It expires in ${CODE_TTL_MIN} minutes.`,
    '',
    copy.ignoreEn,
  ].join('\n');

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        ch
      ]!,
  );

const codeHtml = (copy: EmailCopy, name: string, code: string) => {
  const safeName = escapeHtml(name);
  const codeBlock = `<p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:16px 0;direction:ltr">${code}</p>`;
  return `<div style="font-family:Arial,sans-serif;color:#1f2937;max-width:480px">
  <div dir="rtl" style="text-align:right">
    <p>مرحباً ${safeName}،</p>
    <p>${copy.introAr}:</p>
    ${codeBlock}
    <p>ينتهي الرمز خلال ${CODE_TTL_MIN} دقائق.</p>
  </div>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
  <div dir="ltr" style="text-align:left">
    <p>Hello ${safeName},</p>
    <p>${copy.introEn}:</p>
    ${codeBlock}
    <p>It expires in ${CODE_TTL_MIN} minutes.</p>
    <p style="color:#6b7280;font-size:12px">${copy.ignoreEn}</p>
  </div>
</div>`;
};
