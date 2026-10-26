import { Injectable } from '@nestjs/common';
import nodemailer, { type SendMailOptions, type Transporter } from 'nodemailer';

// Sends email through the SMTP account in SMTP_* (mail.rnec.sa by default).
@Injectable()
export class MailService {
  private transporter?: Transporter;

  // The address emails are sent from.
  get from(): string | undefined {
    return process.env.SMTP_USER;
  }

  async send(options: SendMailOptions): Promise<void> {
    await this.getTransporter().sendMail(options);
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const port = Number(process.env.SMTP_PORT ?? 465);
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? 'mail.rnec.sa',
        port,
        // Port 465 is implicit SSL/TLS; other ports upgrade with STARTTLS.
        secure: port === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      });
    }
    return this.transporter;
  }
}
