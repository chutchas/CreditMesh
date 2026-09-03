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
    /* §4.12–4.16 ------------------------------------------------------- */
    collectionPolicy: {
      strategyWeights: { amount: 0.5, daysOverdue: 0.3, riskGrade: 0.2 },
      contactStages: ['reminder', 'first_call', 'formal_notice', 'final_notice', 'legal_notice'],
      stageTriggerDays: { reminder: 1, first_call: 7, formal_notice: 30, final_notice: 60, legal_notice: 90 },
      ptpMaxDays: 30,
      ptpMaxBrokenBeforeEscalation: 2,
      disputeReasons: ['ของไม่ครบ', 'ราคาไม่ตรงสัญญา', 'ยังไม่ได้รับใบกำกับภาษี', 'รอเอกสารวางบิล', 'คุณภาพสินค้า'],
      escalationMatrix: [],
      holdWhenDisputeAccepted: true,
      workingCalendarHolidays: [],
      assignmentRules: [],
    },
    lateChargePolicy: {
      // One rate with an open-ended period. A second rate is added with its own
      // effectiveFrom rather than by editing this one, so a recomputation of
      // last quarter still uses last quarter's rate.
      rates: [{ annualRatePct: 15, effectiveFrom: '2020-01-01', effectiveTo: null, segment: null, gradeCode: null }],
      dayCountConvention: '365',
      gracePeriodDays: 7,
      chargeStartFrom: 'due_date',
      minimumChargeAmount: 100,
      roundingRule: 'nearest_1',
      compounding: false,
      excludedPartyIds: [],
      waiverAuthority: [],
      approvalChain: [],
      noticeTemplateRef: null,
    },
    paymentPolicy: {
      channels: ['cheque', 'bank_transfer', 'bill_payment', 'e_payment'],
      matchingRules: ['invoice_no', 'amount_and_date', 'party_and_amount'],
      amountTolerance: 1,
      amountTolerancePct: 0.5,
      dateToleranceDays: 5,
      exceptionTypes: [
        'returned_cheque',
        'reversal',
        'mismatch',
        'failed_transfer',
        'overpayment',
        'unidentified_receipt',
      ],
      creditSignalTypes: ['returned_cheque', 'reversal', 'failed_transfer'],
      chequeReturnWindowDays: 60,
      chequeReturnCountForWatchlist: 2,
      resolutionSlaDays: 7,
      unidentifiedReceiptSlaDays: 5,
    },
    legalScreening: {
      // manual_upload only, because it is the one source that needs no data
      // contract: people already run these searches by hand.
      sources: ['manual_upload'],
      scope: 'party',
      frequencyDaysByGrade: { A: 365, B: 270, C: 180, D: 90, E: 30 },
      defaultFrequencyDays: 180,
      requireIdentifierMatch: true,
      eventTypes: [
        'bankruptcy',
        'rehabilitation',
        'legal_execution',
        'litigation',
        'dissolution',
        'liquidation',
      ],
      severityMap: {
        bankruptcy: 'critical',
        rehabilitation: 'critical',
        liquidation: 'critical',
        dissolution: 'high',
        legal_execution: 'high',
        litigation: 'medium',
        status_change: 'low',
      },
      personIdStorage: 'last4',
      personEventVisibleToRoles: ['credit_manager', 'admin'],
      reviewRequired: true,
    },
    riskIndex: {
      // Nine components declared, four enabled — the four whose source modules
      // are live. §7 is explicit that switching them on one at a time beats
      // waiting for all nine, and that a score computed from missing components
      // is worse than no score, which is what absenceRule is for.
      components: [
        { code: 'financial', weight: 0.2, absenceRule: 'no_information', enabled: true },
        { code: 'payment_behavior', weight: 0.15, absenceRule: 'no_information', enabled: true },
        { code: 'delinquency', weight: 0.25, absenceRule: 'treat_as_worst', enabled: true },
        { code: 'collateral_coverage', weight: 0.1, absenceRule: 'no_information', enabled: true },
        { code: 'payment_exception', weight: 0.1, absenceRule: 'no_information', enabled: false },
        { code: 'collection_outcome', weight: 0.05, absenceRule: 'no_information', enabled: false },
        { code: 'group_exposure', weight: 0.05, absenceRule: 'no_information', enabled: false },
        { code: 'legal', weight: 0.1, absenceRule: 'no_information', enabled: false },
        { code: 'company_change', weight: 0.05, absenceRule: 'no_information', enabled: false },
      ],
      scale: 'both',
      recalcTriggers: ['returned_cheque', 'legal_event', 'limit_change', 'import_applied'],
      scoreHistoryRetentionDays: 1095,
      actionMap: [
        { gradeCode: 'D', action: 'ทบทวนวงเงินและขอหลักประกันเพิ่ม' },
        { gradeCode: 'E', action: 'หยุดปล่อยเครดิตใหม่ ส่งเข้าคิวตามหนี้ทันที' },
      ],
      minComponentsForConfidence: 3,
    },
    effectiveFrom: new Date().toISOString().slice(0, 10),
  };
}
