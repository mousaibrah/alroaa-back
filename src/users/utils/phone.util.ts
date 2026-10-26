import { BadRequestException } from '@nestjs/common';

export const DEFAULT_COUNTRY_CODE = '+966';

// Brings a phone number to the stored form: the dialing code as +<digits> and
// the national number as digits only, without the trunk 0 (so 0501234567 and
// 501234567 are the same number). Saudi numbers must be mobiles: 5 + 8 digits.
export function normalizePhone(
  countryCode: string | undefined,
  phoneNumber: string,
): { countryCode: string; phoneNumber: string } {
  const code = `+${(countryCode ?? DEFAULT_COUNTRY_CODE).replace(/\D/g, '')}`;
  const number = phoneNumber.replace(/[\s()-]/g, '').replace(/^0/, '');

  if (!/^\+[1-9][0-9]{0,3}$/.test(code)) {
    throw new BadRequestException('countryCode must look like +966');
  }
  if (!/^[0-9]{4,15}$/.test(number)) {
    throw new BadRequestException('phoneNumber must contain 4 to 15 digits');
  }
  if (code === '+966' && !/^5[0-9]{8}$/.test(number)) {
    throw new BadRequestException(
      'Saudi phone numbers must be a mobile number like 05XXXXXXXX',
    );
  }
  return { countryCode: code, phoneNumber: number };
}
