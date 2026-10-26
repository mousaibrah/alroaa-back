import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { ContactController } from './contact.controller.js';
import { ContactService } from './contact.service.js';

@Module({
  imports: [MailModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
