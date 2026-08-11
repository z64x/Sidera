import { WhatsAppConfig } from './types';

export function normalizeWhatsAppNumber(value: string | undefined | null): string {
  if (!value) return '';
  const trimmed = value.replace(/^whatsapp:/i, '').trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return hasPlus ? `+${digits}` : digits;
}

function normalizeWhatsAppNumberForComparison(value: string | undefined | null): string {
  return normalizeWhatsAppNumber(value).replace(/^\+/, '');
}

export function isWhatsAppNumberAuthorized(from: string, config: WhatsAppConfig | undefined): boolean {
  const allowedNumbers = config?.allowedNumbers || [];
  if (allowedNumbers.length === 0) return false;

  const normalizedFrom = normalizeWhatsAppNumberForComparison(from);
  if (!normalizedFrom) return false;

  return allowedNumbers.some((allowed) => {
    const normalizedAllowed = normalizeWhatsAppNumberForComparison(allowed);
    return normalizedAllowed === normalizedFrom;
  });
}
