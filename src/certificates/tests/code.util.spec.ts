import { describe, expect, it } from 'vitest';
import { generateCertificateCode, normalizeCertificateCode } from '../utils/code.util.js';

describe('certificate codes', () => {
	it('generates RNEC-XXXXX-XXXXX without ambiguous characters', () => {
		for (let i = 0; i < 50; i++) {
			expect(generateCertificateCode()).toMatch(/^RNEC-[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
		}
	});

	it('does not repeat', () => {
		const codes = new Set(Array.from({ length: 200 }, () => generateCertificateCode()));
		expect(codes.size).toBe(200);
	});

	it('normalizes typed codes', () => {
		expect(normalizeCertificateCode(' rnec 7k2m9 xq4pd ')).toBe('RNEC-7K2M9-XQ4PD');
		expect(normalizeCertificateCode('RNEC7K2M9XQ4PD')).toBe('RNEC-7K2M9-XQ4PD');
		expect(normalizeCertificateCode('RNEC-7K2M9-XQ4PD')).toBe('RNEC-7K2M9-XQ4PD');
	});

	it('leaves codes of another shape for the lookup to reject', () => {
		expect(normalizeCertificateCode('abc')).toBe('ABC');
	});
});
