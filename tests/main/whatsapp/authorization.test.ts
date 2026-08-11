import { describe, expect, it } from 'vitest';
import { isWhatsAppNumberAuthorized, normalizeWhatsAppNumber } from '../../../src/main/whatsapp/authorization';

describe('WhatsApp authorization', () => {
  it('normalizes common WhatsApp number formats', () => {
    expect(normalizeWhatsAppNumber('whatsapp:+40 722 123 456')).toBe('+40722123456');
    expect(normalizeWhatsAppNumber('+1 (555) 123-4567')).toBe('+15551234567');
    expect(normalizeWhatsAppNumber('40722123456')).toBe('40722123456');
  });

  it('denies all senders when the allowlist is empty', () => {
    expect(isWhatsAppNumberAuthorized('+40722123456', { allowedNumbers: [] })).toBe(false);
  });

  it('allows senders that match after normalization', () => {
    expect(
      isWhatsAppNumberAuthorized('whatsapp:+40 722 123 456', {
        allowedNumbers: ['+40722123456'],
      })
    ).toBe(true);
  });

  it('allows senders that only differ by plus prefix', () => {
    expect(
      isWhatsAppNumberAuthorized('+40763715580', {
        allowedNumbers: ['40763715580'],
      })
    ).toBe(true);
  });

  it('denies senders not present in the allowlist', () => {
    expect(
      isWhatsAppNumberAuthorized('+40722123456', {
        allowedNumbers: ['+40722999999'],
      })
    ).toBe(false);
  });
});
