import type { Locale } from './i18n/config';

const LOCALE_TAG: Record<Locale, string> = { th: 'th-TH', en: 'en-US' };

export function formatMoney(
  value: number | null | undefined,
  currency: string,
  locale: Locale,
  options: { compact?: boolean } = {},
): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    style: 'currency',
    currency,
    notation: options.compact ? 'compact' : 'standard',
    maximumFractionDigits: options.compact ? 1 : 0,
  }).format(value);
}

export function formatNumber(value: number | null | undefined, locale: Locale, digits = 2): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, locale: Locale, digits = 1): string {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat(LOCALE_TAG[locale], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)}%`;
}

export function formatDate(value: string | null | undefined, locale: Locale): string {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(d);
}

/** "3 days ago" style, used only for freshness where the gap is the point. */
export function formatRelative(value: string | null | undefined, locale: Locale): string {
  if (!value) return '—';
  const then = Date.parse(value);
  if (Number.isNaN(then)) return '—';
  const diffHours = Math.round((Date.now() - then) / 3_600_000);
  const rtf = new Intl.RelativeTimeFormat(LOCALE_TAG[locale], { numeric: 'auto' });
  if (Math.abs(diffHours) < 24) return rtf.format(-diffHours, 'hour');
  return rtf.format(-Math.round(diffHours / 24), 'day');
}
