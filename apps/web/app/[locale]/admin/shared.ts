import type { TenantProfile } from '@creditmesh/core';
import type { Locale } from '../../../lib/i18n/config';

/**
 * The profile editor is bilingual like the rest of the product (NFR §11), but
 * its field labels are the schema's own vocabulary and live next to the fields
 * they name rather than in the shared dictionary. Putting eighty settings-page
 * strings into the app-wide dictionary would bury the vocabulary that actually
 * belongs there — what a counterparty, a limit or an entity is called.
 */
export type Say = (th: string, en: string) => string;

export const makeSay =
  (locale: Locale): Say =>
  (th, en) =>
    locale === 'th' ? th : en;

export interface SectionProps {
  profile: TenantProfile;
  update: (patch: Partial<TenantProfile>) => void;
  say: Say;
  disabled: boolean;
}

export const SECTION_IDS = [
  'identity',
  'entities',
  'sources',
  'enrichment',
  'credit',
  'collateral',
  'groups',
  'workflow',
  'notification',
  'branding',
  'governance',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export function sectionTitle(id: SectionId, say: Say): string {
  switch (id) {
    case 'identity':
      return say('ข้อมูลองค์กรและรูปแบบ', 'Identity & locale');
    case 'entities':
      return say('โครงสร้างนิติบุคคล', 'Organisation structure');
    case 'sources':
      return say('ระบบต้นทางและการจับคู่ field', 'Source systems & field mapping');
    case 'enrichment':
      return say('ผู้ให้บริการข้อมูลนิติบุคคล', 'Enrichment providers');
    case 'credit':
      return say('นโยบายเครดิต', 'Credit policy');
    case 'collateral':
      return say('นโยบายหลักประกัน', 'Collateral policy');
    case 'groups':
      return say('การจับกลุ่มทุน', 'Group resolution');
    case 'workflow':
      return say('บทบาทและสายอนุมัติ', 'Roles & approvals');
    case 'notification':
      return say('การแจ้งเตือน', 'Notifications');
    case 'branding':
      return say('เอกสารและแบรนด์', 'Templates & branding');
    case 'governance':
      return say('ธรรมาภิบาลข้อมูล', 'Data governance');
  }
}

/** Spec §4 numbering, shown so the screen can be read next to the document. */
export function sectionRef(id: SectionId): string {
  const order: Record<SectionId, string> = {
    identity: '§4.1',
    entities: '§4.2',
    sources: '§4.3',
    enrichment: '§4.4',
    credit: '§4.5',
    collateral: '§4.6',
    groups: '§4.7',
    workflow: '§4.8',
    notification: '§4.9',
    branding: '§4.10',
    governance: '§4.11',
  };
  return order[id];
}

/** Which section an issue path belongs to, so errors can be shown on the tab. */
export function sectionForPath(path: string): SectionId | null {
  if (path.startsWith('identity')) return 'identity';
  if (path.startsWith('legalEntities')) return 'entities';
  if (path.startsWith('sourceSystems') || path.startsWith('fieldMappings')) return 'sources';
  if (path.startsWith('enrichmentProviders')) return 'enrichment';
  if (path.startsWith('creditPolicy')) return 'credit';
  if (path.startsWith('collateralPolicy')) return 'collateral';
  if (path.startsWith('groupResolution')) return 'groups';
  if (path.startsWith('workflow')) return 'workflow';
  if (path.startsWith('notification')) return 'notification';
  if (path.startsWith('branding')) return 'branding';
  if (path.startsWith('governance')) return 'governance';
  return null;
}

export type ProfileDraft = TenantProfile;
