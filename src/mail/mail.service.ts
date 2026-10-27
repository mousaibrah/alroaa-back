import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type SendMailOptions, type Transporter } from 'nodemailer';

// Sends email through the SMTP account in SMTP_* (mail.rnec.sa by default).
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Transporter;

  // The address emails are sent from.
  get from(): string | undefined {
    return process.env.SMTP_USER;
  }

  // Logs the server's reply: "250 OK id=…" only means the SMTP server queued
  // the email, and the id is what its delivery log is searched by.
  async send(options: SendMailOptions): Promise<void> {
    const info = await this.getTransporter().sendMail(options);
    const accepted = info.accepted ?? [];
    const rejected = info.rejected ?? [];
    this.logger.log(
      `Sent "${options.subject}" to ${accepted.join(', ')}: ${info.response}`,
    );
    if (rejected.length > 0) {
      this.logger.warn(`Rejected recipients: ${rejected.join(', ')}`);
    }
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const port = Number(process.env.SMTP_PORT ?? 465);
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? 'mail.rnec.sa',
        port,
        // Port 465 is implicit SSL/TLS; other ports upgrade with STARTTLS.
        secure: port === 465,
        // Connecting and logging in takes 1-2s: reuse open connections.
        pool: true,
        maxConnections: 3,
        // Fail fast instead of nodemailer's 2-minute default when the server
        // can't be reached.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      });
    }
    return this.transporter;
  }
}
