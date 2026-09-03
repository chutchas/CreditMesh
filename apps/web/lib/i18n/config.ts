export const LOCALES = ['th', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'th';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
