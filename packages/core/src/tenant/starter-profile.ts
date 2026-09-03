import type { TenantProfile } from './profile';

/**
 * The blank profile a new organisation starts from during onboarding (§10 step 1).
 *
 * P1 acceptance test: no real organisation, BU or segment name may appear here
 * or anywhere else in source. Entity codes are placeholders the admin renames
 * in the profile editor; if a customer's names ever reach this file, the
 * product has stopped being a product.
 */
export function createStarterProfile(tenantId: string, displayName: string): TenantProfile {
  return {
    schemaVersion: 1,
    identity: {
      tenantId,
      displayName,
      baseCurrency: 'THB',
      additionalCurrencies: ['USD'],
      locale: 'th-TH',
      timezone: 'Asia/Bangkok',
      fiscalYearStart: '01-01',
      numberFormat: '1,234.56',
      dateFormat: 'DD/MM/YYYY',
    },
    legalEntities: [
      { code: 'E01', displayName: 'Entity 01', currency: 'THB', parentGroup: null, sourceSystemRef: [], creditSegmentRef: null, isActive: true },
    ],
    sourceSystems: [
      { systemId: 'csv', type: 'csv', adapterVersion: '1', connectionProfileRef: null, syncSchedule: null, entityScope: [] },
    ],
    fieldMappings: [],
    enrichmentProviders: [],
    creditPolicy: {
      // Five bands, no gaps and no overlaps — validateTenantProfile enforces both.
      riskGrades: [
        { code: 'A', label: 'ความเสี่ยงต่ำมาก', minScore: 80, maxScore: 100, color: '#1a7f37' },
        { code: 'B', label: 'ความเสี่ยงต่ำ', minScore: 65, maxScore: 79.9, color: '#4a9d3f' },
        { code: 'C', label: 'ความเสี่ยงปานกลาง', minScore: 50, maxScore: 64.9, color: '#c99700' },
        { code: 'D', label: 'ความเสี่ยงสูง', minScore: 35, maxScore: 49.9, color: '#d1691a' },
        { code: 'E', label: 'ความเสี่ยงสูงมาก', minScore: 0, maxScore: 34.9, color: '#b42318' },
      ],
      // Current arrears outweigh any single financial-statement measure: a
      // balance sheet describes a year end that may be long past, an unpaid
      // invoice describes today.
      scoringWeights: {
        profitability: 0.15,
        liquidity: 0.15,
        leverage: 0.1,
        equity_strength: 0.1,
        filing_currency: 0.1,
        payment_behavior: 0.15,
        delinquency: 0.25,
      },
      agingBuckets: [
        { code: 'not_due', label: 'ยังไม่ครบกำหนด', fromDays: -100000, toDays: 0 },
        { code: 'd1_30', label: '1–30 วัน', fromDays: 1, toDays: 30 },
        { code: 'd31_60', label: '31–60 วัน', fromDays: 31, toDays: 60 },
        { code: 'd61_90', label: '61–90 วัน', fromDays: 61, toDays: 90 },
        { code: 'd90_plus', label: 'เกิน 90 วัน', fromDays: 91, toDays: null },
      ],
      dpdDefinition: 'from_due_date',
      reviewFrequencyByGrade: { A: 365, B: 365, C: 180, D: 90, E: 30 },
      limitApprovalMatrix: [],
    },
    collateralPolicy: {
      collateralTypes: ['bank_guarantee', 'letter_of_credit', 'cash_deposit', 'parent_guarantee'],
      allocationMethod: 'manual',
      priorityOrder: [],
      reallocationApproval: [],
      expiryAlertDays: [90, 60, 30, 7],
      allowOverAllocation: false,
    },
    groupResolution: {
      signalsEnabled: ['shareholder', 'director', 'registered_address'],
      signalWeights: { shareholder: 0.5, director: 0.3, registered_address: 0.15, name_similarity: 0.05 },
      // 0.3 is chosen so the weights above produce a coherent default: a shared
      // shareholder (0.5) or a shared director (0.3) is enough to propose a
      // group for review, while a shared address (0.15) or a similar name
      // (0.05) never proposes one on its own. Those two are the noisy signals —
      // an address is usually a building and a name is usually a coincidence —
      // so they only ever corroborate something stronger.
      confidenceThreshold: 0.3,
      autoApply: false,
      excludedAddresses: [],
      excludedPersons: [],
    },
    workflow: {
      roles: [
        // Default deny-by-breadth: only the central role sees across entities.
        { code: 'admin', label: 'ผู้ดูแลระบบ', permissions: ['*'], entityScope: [] },
        { code: 'central_credit', label: 'เครดิตส่วนกลาง', permissions: ['read:all', 'write:assessment', 'write:collateral'], entityScope: [] },
        { code: 'entity_user', label: 'ผู้ใช้ระดับนิติบุคคล', permissions: ['read:own_entity'], entityScope: ['E01'] },
        { code: 'auditor', label: 'ผู้ตรวจสอบ', permissions: ['read:all', 'read:audit'], entityScope: [] },
      ],
      approvalChains: [],
      slaTargets: [],
      delegationRules: [],
    },
    notification: {
      channels: ['email'],
      detailLevel: 'summary',
      severityRouting: {},
      quietHours: null,
      digestSchedule: null,
    },
    branding: {
      documentTemplates: {},
      logoUrl: null,
      primaryColor: '#1f4e79',
      languagePack: {},
    },
    governance: {
      retentionDaysByEntity: {},
      piiMaskingRules: [{ field: 'person.national_id', rule: 'mask' }],
      auditRetentionYears: 7,
      dataResidency: 'unspecified',
      exportPolicy: 'allow',
    },
    effectiveFrom: new Date().toISOString().slice(0, 10),
  };
}
