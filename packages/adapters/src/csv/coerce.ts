/**
 * Value coercion for spreadsheet input.
 *
 * Everything arrives as a string typed by a person or exported by Excel, so the
 * shapes below are the ones actually seen in the wild, not the ones a schema
 * would prefer: thousands separators, parenthesised negatives, trailing minus,
 * and four different date orders.
 */

export type Coerced<T> = { ok: true; value: T } | { ok: false; reason: string };

export function coerceNumber(raw: string): Coerced<number | null> {
  const s = raw.trim();
  if (s === '' || s === '-' || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'null') {
    return { ok: true, value: null };
  }
  // (1,234.50) is accounting notation for a negative, and 1,234.50- comes out
  // of several ERP exports; both mean the same thing.
  let negative = false;
  let body = s;
  if (/^\(.*\)$/.test(body)) {
    negative = true;
    body = body.slice(1, -1);
  }
  if (/-$/.test(body)) {
    negative = true;
    body = body.slice(0, -1);
  }
  body = body.replace(/[,\s]/g, '').replace(/^\+/, '');
  if (body.startsWith('-')) {
    negative = !negative;
    body = body.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(body) && !/^\d+\.$/.test(body)) {
    return { ok: false, reason: `"${raw}" is not a number` };
  }
  const n = Number(body);
  if (!Number.isFinite(n)) return { ok: false, reason: `"${raw}" is not a number` };
  return { ok: true, value: negative ? -n : n };
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/;
const YMD_COMPACT = /^(\d{4})(\d{2})(\d{2})$/;

export interface DateOptions {
  /** Disambiguates 03/04/2026. Defaults to day-first, which Thai exports use. */
  order?: 'dmy' | 'mdy';
  /**
   * Buddhist-era years appear in Thai systems as 2569 rather than 2026.
   * Converted only when the year is implausibly far in the future.
   */
  acceptBuddhistEra?: boolean;
}

export function coerceDate(raw: string, options: DateOptions = {}): Coerced<string | null> {
  const { order = 'dmy', acceptBuddhistEra = true } = options;
  const s = raw.trim();
  if (s === '' || s.toLowerCase() === 'n/a' || s === '0000-00-00') return { ok: true, value: null };

  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;

  if ((match = s.match(ISO))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = s.match(YMD_COMPACT))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = s.match(DMY))) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    y = Number(match[3]);
    if (order === 'mdy') {
      m = a;
      d = b;
    } else {
      d = a;
      m = b;
    }
  } else {
    return { ok: false, reason: `"${raw}" is not a recognised date` };
  }

  if (acceptBuddhistEra && y > 2400) y -= 543;
  if (m < 1 || m > 12 || d < 1 || d > 31) return { ok: false, reason: `"${raw}" is out of range` };

  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // Round-trip check catches 31/02 and similar.
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    return { ok: false, reason: `"${raw}" is not a real date` };
  }
  return { ok: true, value: iso };
}

export function applyTransform(value: string, transform: string, arg: string | null): string {
  switch (transform) {
    case 'trim':
      return value.trim();
    case 'pad':
      return value.padStart(Number(arg ?? 0), '0');
    case 'regex': {
      if (!arg) return value;
      const m = value.match(new RegExp(arg));
      return m ? (m[1] ?? m[0]) : value;
    }
    case 'lookup': {
      if (!arg) return value;
      try {
        const table = JSON.parse(arg) as Record<string, string>;
        return table[value] ?? value;
      } catch {
        return value;
      }
    }
    default:
      return value;
  }
}
