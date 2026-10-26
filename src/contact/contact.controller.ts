import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';
import { ContactService } from './contact.service.js';
import { ContactDto } from './dto/contact.dto.js';

@Public()
@ApiTags('Contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a contact us message (open to everyone)',
    description: 'Emails the message to the site inbox.',
  })
  @ApiOkResponse({ description: 'The message was sent' })
  @ApiServiceUnavailableResponse({ description: 'The email could not be sent' })
  send(@Body() dto: ContactDto) {
    return this.contactService.send(dto);
  }
}
