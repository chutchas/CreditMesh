import { z } from 'zod';

/**
 * Tenant Profile (Spec §4) — P1 "config over code".
 *
 * Everything that carries an organisation's own names, thresholds, grades and
 * approval chains lives here, versioned, not in source. The acceptance test in
 * the spec is literal: grep the repo for a customer's name; if it appears
 * outside a profile fixture, the product is not a product yet.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const currency = z.string().length(3).regex(/^[A-Z]{3}$/, 'expected ISO-4217');
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/* §4.1 Identity & locale ------------------------------------------------ */
export const IdentitySchema = z.object({
  tenantId: z.string().min(1),
  displayName: z.string().min(1),
  baseCurrency: currency,
  additionalCurrencies: z.array(currency).default([]),
  locale: z.enum(['th-TH', 'en-US']).default('th-TH'),
  timezone: z.string().default('Asia/Bangkok'),
  /** `MM-DD`; a fiscal year that does not start in January is common enough. */
  fiscalYearStart: z.string().regex(/^\d{2}-\d{2}$/).default('01-01'),
  numberFormat: z.enum(['1,234.56', '1.234,56']).default('1,234.56'),
  dateFormat: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY']).default('DD/MM/YYYY'),
});

/* §4.2 Organisation structure ------------------------------------------- */
export const LegalEntitySchema = z.object({
  code: z.string().min(1),
  displayName: z.string().min(1),
  currency: currency,
  /** Nested BUs and nested companies both occur; one field handles both. */
  parentGroup: z.string().nullable().default(null),
  sourceSystemRef: z.array(z.string()).default([]),
  creditSegmentRef: z.string().nullable().default(null),
  isActive: z.boolean().default(true),
});

/* §4.3 Source systems & field mapping ----------------------------------- */
export const SourceSystemSchema = z.object({
  systemId: z.string().min(1),
  type: z.enum(['erp_a', 'erp_b', 'warehouse', 'csv', 'rest']),
  adapterVersion: z.string().default('1'),
  /** Points at the secret store. Credentials never live in the profile (§11). */
  connectionProfileRef: z.string().nullable().default(null),
  syncSchedule: z.string().nullable().default(null),
  entityScope: z.array(z.string()).default([]),
});

export const FieldMappingSchema = z.object({
  canonicalField: z.string().min(1),
  sourcePath: z.string().min(1),
  transform: z.enum(['none', 'trim', 'pad', 'regex', 'lookup']).default('none'),
  transformArg: z.string().nullable().default(null),
  required: z.boolean().default(false),
});

/* §4.4 Enrichment providers --------------------------------------------- */
export const EnrichmentProviderSchema = z.object({
  providerId: z.string().min(1),
  credentialRef: z.string().nullable().default(null),
  enabledDatasets: z
    .array(z.enum(['financial_statement', 'shareholder', 'director', 'status', 'litigation']))
    .default([]),
  /** The tenant pays per call; an unbounded engine will spend their money. */
  quotaPerDay: z.number().int().positive().nullable().default(null),
  cacheTtlDays: z.number().int().positive().default(90),
});

/* §4.5 Credit policy ----------------------------------------------------- */
export const RiskGradeSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  minScore: z.number(),
  maxScore: z.number(),
  color: hexColor,
});

export const AgingBucketSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  fromDays: z.number().int(),
  /** null = open-ended bucket. Exactly one bucket may be open-ended. */
  toDays: z.number().int().nullable(),
});

export const CreditPolicySchema = z.object({
  riskGrades: z.array(RiskGradeSchema).min(1),
  scoringWeights: z.record(z.string(), z.number()),
  agingBuckets: z.array(AgingBucketSchema).min(1),
  /** Organisations genuinely disagree on this; it changes every DPD number. */
  dpdDefinition: z.enum(['from_due_date', 'from_invoice_date']).default('from_due_date'),
  reviewFrequencyByGrade: z.record(z.string(), z.number().int().positive()),
  limitApprovalMatrix: z
    .array(
      z.object({
        fromAmount: z.number(),
        toAmount: z.number().nullable(),
        approverRole: z.string(),
      }),
    )
    .default([]),
});

/* §4.6 Collateral policy ------------------------------------------------- */
export const CollateralPolicySchema = z.object({
  collateralTypes: z
    .array(
      z.enum([
        'bank_guarantee',
        'letter_of_credit',
        'cash_deposit',
        'parent_guarantee',
        'performance_bond',
        'insurance',
        'other',
      ]),
    )
    .min(1),
  allocationMethod: z.enum(['manual', 'pro_rata', 'priority_order']).default('manual'),
  priorityOrder: z.array(z.string()).default([]),
  reallocationApproval: z.array(z.string()).default([]),
  expiryAlertDays: z.array(z.number().int().positive()).default([90, 60, 30, 7]),
  allowOverAllocation: z.boolean().default(false),
});

/* §4.7 Group resolution policy ------------------------------------------ */
export const GroupResolutionPolicySchema = z.object({
  signalsEnabled: z
    .array(z.enum(['shareholder', 'director', 'registered_address', 'name_similarity']))
    .default(['shareholder', 'director']),
  signalWeights: z.record(z.string(), z.number()).default({}),
  confidenceThreshold: z.number().min(0).max(1).default(0.6),
  /** Default false, always. The system proposes; a human confirms (§7 M2). */
  autoApply: z.boolean().default(false),
  /**
   * Without these two lists the engine reports accounting firms and nominee
   * directors as conglomerates, and users stop believing it in week one.
   */
  excludedAddresses: z.array(z.string()).default([]),
  excludedPersons: z.array(z.string()).default([]),
});

/* §4.8 Workflow, roles & SLA -------------------------------------------- */
export const RoleSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  permissions: z.array(z.string()).default([]),
  /** Empty = every entity (central credit). Otherwise scoped to these codes. */
  entityScope: z.array(z.string()).default([]),
});

export const WorkflowPolicySchema = z.object({
  roles: z.array(RoleSchema).min(1),
  approvalChains: z
    .array(z.object({ requestType: z.string(), steps: z.array(z.string()) }))
    .default([]),
  slaTargets: z.array(z.object({ requestType: z.string(), businessDays: z.number().int() })).default([]),
  delegationRules: z.array(z.object({ fromRole: z.string(), toRole: z.string() })).default([]),
});

/* §4.9 Notification policy ---------------------------------------------- */
export const NotificationPolicySchema = z.object({
  channels: z.array(z.enum(['email', 'teams', 'line', 'webhook'])).default(['email']),
  /** `link_only` exists for organisations that forbid counterparty data in chat apps. */
  detailLevel: z.enum(['full', 'summary', 'link_only']).default('summary'),
  severityRouting: z.record(z.string(), z.array(z.string())).default({}),
  quietHours: z.object({ from: z.string(), to: z.string() }).nullable().default(null),
  digestSchedule: z.string().nullable().default(null),
});

/* §4.10 Templates & branding -------------------------------------------- */
export const BrandingSchema = z.object({
  documentTemplates: z.record(z.string(), z.string()).default({}),
  logoUrl: z.string().nullable().default(null),
  primaryColor: hexColor.default('#1f4e79'),
  /** What this organisation calls a BU, a limit, a counterparty. */
  languagePack: z.record(z.string(), z.record(z.string(), z.string())).default({}),
});

/* §4.11 Data governance -------------------------------------------------- */
export const GovernanceSchema = z.object({
  retentionDaysByEntity: z.record(z.string(), z.number().int().positive()).default({}),
  piiMaskingRules: z.array(z.object({ field: z.string(), rule: z.enum(['mask', 'hash', 'drop']) })).default([]),
  auditRetentionYears: z.number().int().positive().default(7),
  dataResidency: z.string().default('unspecified'),
  exportPolicy: z.enum(['allow', 'watermark', 'deny']).default('allow'),
});

/* ----------------------------------------------------------------------- */
/* §4.12–4.16 — the Collect and Legal sections, appended after 4.11.        */
/*                                                                          */
/* Appended rather than inserted, even though 4.12 belongs next to 4.5 by   */
/* topic. The profile editor and every stored profile version address       */
/* sections by number; inserting in the middle would make an already-saved   */
/* v1 profile read wrong. Every field here carries a default and every       */
/* section is `.default({})` at the top level, so a profile saved before      */
/* these existed still parses and simply picks up the defaults.              */
/* ----------------------------------------------------------------------- */

/* §4.12 Collection policy ------------------------------------------------ */
export const CollectionPolicySchema = z.object({
  /** Ordering inputs for the daily queue, weighted. Not a risk score. */
  strategyWeights: z
    .object({ amount: z.number(), daysOverdue: z.number(), riskGrade: z.number() })
    .default({ amount: 0.5, daysOverdue: 0.3, riskGrade: 0.2 }),
  contactStages: z
    .array(z.enum(['reminder', 'first_call', 'formal_notice', 'final_notice', 'legal_notice']))
    .default(['reminder', 'first_call', 'formal_notice', 'final_notice', 'legal_notice']),
  /** Days past due at which each stage becomes appropriate. */
  stageTriggerDays: z.record(z.string(), z.number().int()).default({
    reminder: 1,
    first_call: 7,
    formal_notice: 30,
    final_notice: 60,
    legal_notice: 90,
  }),
  ptpMaxDays: z.number().int().positive().default(30),
  ptpMaxBrokenBeforeEscalation: z.number().int().positive().default(2),
  disputeReasons: z
    .array(z.string())
    .default(['ของไม่ครบ', 'ราคาไม่ตรงสัญญา', 'ยังไม่ได้รับใบกำกับภาษี', 'รอเอกสารวางบิล', 'คุณภาพสินค้า']),
  escalationMatrix: z
    .array(z.object({ fromAmount: z.number(), toAmount: z.number().nullable(), role: z.string() }))
    .default([]),
  /** Cases nobody may chase — a dispute the organisation has itself accepted. */
  holdWhenDisputeAccepted: z.boolean().default(true),
  workingCalendarHolidays: z.array(isoDate).default([]),
  assignmentRules: z
    .array(z.object({ legalEntityCode: z.string().nullable(), segment: z.string().nullable(), ownerRole: z.string() }))
    .default([]),
});

/* §4.13 Late payment charge policy -------------------------------------- */
export const LateChargeRateSchema = z.object({
  /** Annual percentage. Stored with the period it applied to, never alone. */
  annualRatePct: z.number(),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable().default(null),
  segment: z.string().nullable().default(null),
  gradeCode: z.string().nullable().default(null),
});

export const LateChargePolicySchema = z.object({
  rates: z.array(LateChargeRateSchema).default([]),
  dayCountConvention: z.enum(['365', '360', 'actual']).default('365'),
  gracePeriodDays: z.number().int().min(0).default(7),
  chargeStartFrom: z.enum(['due_date', 'invoice_date']).default('due_date'),
  minimumChargeAmount: z.number().min(0).default(100),
  roundingRule: z.enum(['none', 'nearest_1', 'nearest_0.01', 'down_1']).default('nearest_1'),
  /** Almost always false. Compounding a late charge is a contract question. */
  compounding: z.boolean().default(false),
  excludedPartyIds: z.array(z.string()).default([]),
  waiverAuthority: z
    .array(z.object({ role: z.string(), maxAmount: z.number().nullable() }))
    .default([]),
  approvalChain: z.array(z.string()).default([]),
  noticeTemplateRef: z.string().nullable().default(null),
});

/* §4.14 Payment & exception policy -------------------------------------- */
export const PaymentPolicySchema = z.object({
  channels: z
    .array(
      z.enum([
        'cheque',
        'bill_of_exchange',
        'bank_transfer',
        'bill_payment',
        'barcode',
        'e_payment',
        'direct_debit',
        'cash',
        'other',
      ]),
    )
    .default(['cheque', 'bank_transfer', 'bill_payment', 'e_payment']),
  /** Tried in order. The first rule that resolves to exactly one invoice wins. */
  matchingRules: z
    .array(z.enum(['invoice_no', 'amount_and_date', 'party_and_amount', 'party_and_reference']))
    .default(['invoice_no', 'amount_and_date', 'party_and_amount']),
  amountTolerance: z.number().min(0).default(1),
  amountTolerancePct: z.number().min(0).default(0.5),
  dateToleranceDays: z.number().int().min(0).default(5),
  exceptionTypes: z
    .array(
      z.enum([
        'returned_cheque',
        'reversal',
        'mismatch',
        'missing',
        'failed_transfer',
        'overpayment',
        'unidentified_receipt',
      ]),
    )
    .default(['returned_cheque', 'reversal', 'mismatch', 'failed_transfer', 'overpayment', 'unidentified_receipt']),
  /**
   * The heart of §4.14 (P7): which exception types stop being an accounting
   * chore and become a credit signal. A returned cheque that ends its life in
   * a reconciliation report is data thrown away.
   */
  creditSignalTypes: z
    .array(z.string())
    .default(['returned_cheque', 'reversal', 'failed_transfer']),
  chequeReturnWindowDays: z.number().int().positive().default(60),
  chequeReturnCountForWatchlist: z.number().int().positive().default(2),
  resolutionSlaDays: z.number().int().positive().default(7),
  unidentifiedReceiptSlaDays: z.number().int().positive().default(5),
});

/* §4.15 Legal & insolvency screening policy ------------------------------ */
export const LegalScreeningPolicySchema = z.object({
  sources: z
    .array(z.enum(['led', 'dbd', 'court', 'provider_api', 'manual_upload']))
    .default(['manual_upload']),
  scope: z.enum(['party', 'person', 'both']).default('party'),
  /** Days between screenings per grade. A worse grade is looked at more often. */
  frequencyDaysByGrade: z.record(z.string(), z.number().int().positive()).default({}),
  defaultFrequencyDays: z.number().int().positive().default(180),
  /**
   * Never `name_only`. Matching a court result on a name alone produces a
   * confident, evidenced, wrong conclusion about a named individual — the same
   * failure Module 8 warns about, except here it damages a person's reputation.
   */
  requireIdentifierMatch: z.boolean().default(true),
  eventTypes: z
    .array(
      z.enum([
        'bankruptcy',
        'rehabilitation',
        'legal_execution',
        'litigation',
        'dissolution',
        'liquidation',
        'status_change',
      ]),
    )
    .default(['bankruptcy', 'rehabilitation', 'legal_execution', 'litigation', 'dissolution', 'liquidation']),
  severityMap: z
    .record(z.string(), z.enum(['critical', 'high', 'medium', 'low']))
    .default({
      bankruptcy: 'critical',
      rehabilitation: 'critical',
      liquidation: 'critical',
      dissolution: 'high',
      legal_execution: 'high',
      litigation: 'medium',
      status_change: 'low',
    }),
  /** How much of a natural person's identifier may be stored at all. */
  personIdStorage: z.enum(['none', 'last4', 'hash']).default('last4'),
  personEventVisibleToRoles: z.array(z.string()).default(['credit_manager', 'admin']),
  /** Default true, and the UI does not offer a way to turn it off cheaply. */
  reviewRequired: z.boolean().default(true),
});

/* §4.16 Risk index policy ------------------------------------------------ */
export const RiskIndexComponentSchema = z.object({
  code: z.string().min(1),
  weight: z.number().min(0),
  /**
   * What "no data" means for this component. Redistributing the weight onto
   * whatever data does exist is never the default: that is exactly how a
   * counterparty with its entire balance past due and no cleared history once
   * scored well off a two-year-old balance sheet.
   */
  absenceRule: z.enum(['no_information', 'treat_as_worst', 'block_score']).default('no_information'),
  enabled: z.boolean().default(true),
});

export const RiskIndexPolicySchema = z.object({
  components: z.array(RiskIndexComponentSchema).default([]),
  scale: z.enum(['score', 'grade', 'both']).default('both'),
  recalcTriggers: z
    .array(z.string())
    .default(['returned_cheque', 'legal_event', 'limit_change', 'import_applied']),
  scoreHistoryRetentionDays: z.number().int().positive().default(1095),
  actionMap: z
    .array(z.object({ gradeCode: z.string(), action: z.string() }))
    .default([]),
  /** Below this many scored components the index is shown as incomplete. */
  minComponentsForConfidence: z.number().int().positive().default(3),
});

export const TenantProfileSchema = z.object({
  schemaVersion: z.literal(1),
  identity: IdentitySchema,
  legalEntities: z.array(LegalEntitySchema).min(1),
  sourceSystems: z.array(SourceSystemSchema).default([]),
  fieldMappings: z.array(FieldMappingSchema).default([]),
  enrichmentProviders: z.array(EnrichmentProviderSchema).default([]),
  creditPolicy: CreditPolicySchema,
  collateralPolicy: CollateralPolicySchema,
  groupResolution: GroupResolutionPolicySchema,
  workflow: WorkflowPolicySchema,
  notification: NotificationPolicySchema,
  branding: BrandingSchema,
  governance: GovernanceSchema,
  // §4.12–4.16. Defaulted so a profile stored before these sections existed
  // still validates instead of locking an organisation out of its own editor.
  collectionPolicy: CollectionPolicySchema.default({}),
  lateChargePolicy: LateChargePolicySchema.default({}),
  paymentPolicy: PaymentPolicySchema.default({}),
  legalScreening: LegalScreeningPolicySchema.default({}),
  riskIndex: RiskIndexPolicySchema.default({}),
  effectiveFrom: isoDate,
});

export type TenantProfile = z.infer<typeof TenantProfileSchema>;
export type RiskGrade = z.infer<typeof RiskGradeSchema>;
export type AgingBucket = z.infer<typeof AgingBucketSchema>;
export type FieldMapping = z.infer<typeof FieldMappingSchema>;
export type TenantRole = z.infer<typeof RoleSchema>;
export type CollateralPolicy = z.infer<typeof CollateralPolicySchema>;
export type NotificationPolicy = z.infer<typeof NotificationPolicySchema>;
export type CollectionPolicy = z.infer<typeof CollectionPolicySchema>;
export type LateChargePolicy = z.infer<typeof LateChargePolicySchema>;
export type LateChargeRate = z.infer<typeof LateChargeRateSchema>;
export type PaymentPolicy = z.infer<typeof PaymentPolicySchema>;
export type LegalScreeningPolicy = z.infer<typeof LegalScreeningPolicySchema>;
export type RiskIndexPolicy = z.infer<typeof RiskIndexPolicySchema>;
export type RiskIndexComponentConfig = z.infer<typeof RiskIndexComponentSchema>;

export interface ProfileValidationIssue {
  path: string;
  message: string;
}

/**
 * Structural validation plus the cross-field rules zod cannot express.
 * Returns issues rather than throwing: the profile editor shows all of them at
 * once, and an admin fixing six things one round-trip at a time gives up.
 */
export function validateTenantProfile(
  input: unknown,
): { ok: true; profile: TenantProfile } | { ok: false; issues: ProfileValidationIssue[] } {
  const parsed = TenantProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  const p = parsed.data;
  const issues: ProfileValidationIssue[] = [];

  const entityCodes = new Set<string>();
  p.legalEntities.forEach((e, i) => {
    if (entityCodes.has(e.code)) issues.push({ path: `legalEntities.${i}.code`, message: `duplicate entity code "${e.code}"` });
    entityCodes.add(e.code);
  });
  p.legalEntities.forEach((e, i) => {
    if (e.parentGroup && !entityCodes.has(e.parentGroup)) {
      issues.push({ path: `legalEntities.${i}.parentGroup`, message: `unknown parent "${e.parentGroup}"` });
    }
  });

  const grades = [...p.creditPolicy.riskGrades].sort((a, b) => a.minScore - b.minScore);
  for (let i = 0; i < grades.length; i += 1) {
    const g = grades[i]!;
    if (g.minScore > g.maxScore) {
      issues.push({ path: `creditPolicy.riskGrades.${g.code}`, message: 'minScore greater than maxScore' });
    }
    const next = grades[i + 1];
    if (next && next.minScore <= g.maxScore) {
      issues.push({
        path: `creditPolicy.riskGrades.${g.code}`,
        message: `score band overlaps "${next.code}" — a score would resolve to two grades`,
      });
    }
  }

  const openEnded = p.creditPolicy.agingBuckets.filter((b) => b.toDays === null);
  if (openEnded.length !== 1) {
    issues.push({
      path: 'creditPolicy.agingBuckets',
      message: `exactly one open-ended bucket required, found ${openEnded.length}`,
    });
  }

  if (p.collateralPolicy.allocationMethod === 'priority_order') {
    if (p.collateralPolicy.priorityOrder.length === 0) {
      issues.push({ path: 'collateralPolicy.priorityOrder', message: 'required when allocationMethod is priority_order' });
    }
    p.collateralPolicy.priorityOrder.forEach((code, i) => {
      if (!entityCodes.has(code)) {
        issues.push({ path: `collateralPolicy.priorityOrder.${i}`, message: `unknown entity "${code}"` });
      }
    });
  }

  p.workflow.roles.forEach((r, i) => {
    r.entityScope.forEach((code) => {
      if (!entityCodes.has(code)) {
        issues.push({ path: `workflow.roles.${i}.entityScope`, message: `unknown entity "${code}"` });
      }
    });
  });

  p.sourceSystems.forEach((s, i) => {
    s.entityScope.forEach((code) => {
      if (!entityCodes.has(code)) {
        issues.push({ path: `sourceSystems.${i}.entityScope`, message: `unknown entity "${code}"` });
      }
    });
  });

  if (p.groupResolution.autoApply) {
    issues.push({
      path: 'groupResolution.autoApply',
      message: 'auto-apply of group resolution is not permitted — a human must confirm (Spec §7 Module 2)',
    });
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, profile: p };
}

/** Grade lookup used by the scoring engine and every badge in the UI. */
export function gradeForScore(profile: TenantProfile, score: number): RiskGrade | null {
  return profile.creditPolicy.riskGrades.find((g) => score >= g.minScore && score <= g.maxScore) ?? null;
}
