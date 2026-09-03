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
  effectiveFrom: isoDate,
});

export type TenantProfile = z.infer<typeof TenantProfileSchema>;
export type RiskGrade = z.infer<typeof RiskGradeSchema>;
export type AgingBucket = z.infer<typeof AgingBucketSchema>;
export type FieldMapping = z.infer<typeof FieldMappingSchema>;
export type TenantRole = z.infer<typeof RoleSchema>;

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
