import { randomInt } from 'node:crypto';

export const CODE_PREFIX = 'RNEC';
// No 0/O/1/I/L: the code is read and typed by people.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

// e.g. RNEC-7K2M9-XQ4PD (10 random characters, about 50 bits).
export function generateCertificateCode(): string {
	const chars = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
	return `${CODE_PREFIX}-${chars.slice(0, 5)}-${chars.slice(5)}`;
}

// Lets people type the code in any case, with spaces or without dashes.
export function normalizeCertificateCode(input: string): string {
	const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
	if (!raw.startsWith(CODE_PREFIX)) return input.trim().toUpperCase();
	const body = raw.slice(CODE_PREFIX.length);
	return `${CODE_PREFIX}-${body.slice(0, 5)}-${body.slice(5)}`;
}
