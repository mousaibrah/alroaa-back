import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MailService } from '../mail/mail.service.js';
import { ContactDto } from './dto/contact.dto.js';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(private readonly mail: MailService) {}

  async send(dto: ContactDto): Promise<{ message: string }> {
    const from = this.mail.from;
    const to = process.env.CONTACT_TO_EMAIL || from;

    try {
      await this.mail.send({
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
}
