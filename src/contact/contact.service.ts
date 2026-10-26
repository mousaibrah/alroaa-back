import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { ContactDto } from './dto/contact.dto.js';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  private transporter?: Transporter;

  async send(dto: ContactDto): Promise<{ message: string }> {
    const from = process.env.SMTP_USER;
    const to = process.env.CONTACT_TO_EMAIL || from;

    try {
      await this.getTransporter().sendMail({
        from: `"Alroaa Contact Form" <${from}>`,
        to,
        // Replying in the mail client goes straight to the visitor.
        replyTo: { name: dto.fullName, address: dto.email },
        subject: `Contact form: ${dto.fullName}`,
        text: [
          `Full name: ${dto.fullName}`,
          `Phone number: ${dto.phoneNumber}`,
          `Email: ${dto.email}`,
          '',
          'Message:',
          dto.message,
        ].join('\n'),
      });
    } catch (err) {
      this.logger.error('Failed to send contact email', err as Error);
      throw new ServiceUnavailableException(
        'Could not send your message, please try again later',
      );
    }

    return { message: 'Your message has been sent' };
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
