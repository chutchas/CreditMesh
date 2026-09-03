import { NextResponse } from 'next/server';
import { importCsv, getDataset } from '@creditmesh/adapters';
import { createAdminClient } from '../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../lib/session';
import {
  applyArItemRows,
  applyCollateralAllocationRows,
  applyCollateralRows,
  applyCreditLimitRows,
  applyDirectorRows,
  applyFinancialStatementRows,
  applyPartyRows,
  applyRegistryProfileRows,
  applyShareholderRows,
  applyIncomingPaymentRows,
  applyLegalEventRows,
  applyPaymentExceptionRows,
  applyOrderBlockRows,
  applySupplierCommitmentRows,
  type ApplyContext,
} from '../../../lib/ingest';

export const runtime = 'nodejs';
// Files can be tens of thousands of rows; the default budget is not enough.
export const maxDuration = 60;

/**
 * One endpoint, two modes. `dryRun` validates and returns the report without
 * touching the database, which is what the screen shows before the user commits
 * — §10 step 4 makes reconciliation an acceptance condition, and that is only
 * possible if people can see what a file will do before it does it.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const form = await request.formData();
  const file = form.get('file');
  const datasetId = String(form.get('datasetId') ?? '');
  const dryRun = String(form.get('dryRun') ?? 'true') === 'true';
  const dataAsOf = (form.get('dataAsOf') as string | null) || null;

  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (!getDataset(datasetId)) return NextResponse.json({ error: `unknown dataset "${datasetId}"` }, { status: 400 });

  const text = await file.text();
  const baseCurrency = session.profile.identity.baseCurrency;
  const result = importCsv(text, {
    datasetId,
    systemId: 'csv',
    defaultCurrency: baseCurrency,
    dataAsOf,
  });

  if (dryRun) {
    return NextResponse.json({
      report: result.report,
      preview: result.rows.slice(0, 20),
      applied: false,
    });
  }

  if (result.rows.length === 0) {
    return NextResponse.json({ report: result.report, applied: false, notes: ['nothing to apply'] });
  }

  const admin = createAdminClient();
  const { data: batch } = await admin
    .from('import_batch')
    .insert({
      tenant_id: session.tenantId,
      system_id: 'csv',
      dataset_id: datasetId,
      file_name: file.name,
      status: 'validating',
      rows_read: result.report.rowsRead,
      rows_accepted: result.report.rowsAccepted,
      rows_rejected: result.report.rowsRejected,
      data_as_of: dataAsOf,
      errors: result.report.errors,
      warnings: result.report.warnings,
      uploaded_by: session.userId,
    })
    .select('id')
    .single();

  const ctx: ApplyContext = {
    admin,
    tenantId: session.tenantId,
    systemId: 'csv',
    actorId: session.userId,
    dataAsOf,
  };

  let apply;
  switch (datasetId) {
    case 'party':
      apply = await applyPartyRows(ctx, result.rows);
      break;
    case 'ar_item':
      apply = await applyArItemRows(ctx, result.rows, baseCurrency);
      break;
    case 'credit_limit':
      apply = await applyCreditLimitRows(ctx, result.rows, baseCurrency);
      break;
    case 'financial_statement':
      apply = await applyFinancialStatementRows(ctx, result.rows, baseCurrency);
      break;
    case 'registry_profile':
      apply = await applyRegistryProfileRows(ctx, result.rows);
      break;
    case 'director':
      apply = await applyDirectorRows(ctx, result.rows);
      break;
    case 'shareholder':
      apply = await applyShareholderRows(ctx, result.rows);
      break;
    case 'supplier_commitment':
      apply = await applySupplierCommitmentRows(ctx, result.rows, baseCurrency);
      break;
    case 'collateral':
      apply = await applyCollateralRows(ctx, result.rows, baseCurrency);
      break;
    case 'collateral_allocation':
      apply = await applyCollateralAllocationRows(ctx, result.rows);
      break;
    case 'order_block':
      apply = await applyOrderBlockRows(ctx, result.rows, baseCurrency);
      break;
    case 'legal_event':
      apply = await applyLegalEventRows(ctx, result.rows, session.profile.legalScreening);
      break;
    case 'incoming_payment':
      apply = await applyIncomingPaymentRows(ctx, result.rows, baseCurrency, session.profile.paymentPolicy);
      break;
    case 'payment_exception':
      apply = await applyPaymentExceptionRows(ctx, result.rows, baseCurrency);
      break;
    default:
      return NextResponse.json({ error: `no writer for dataset "${datasetId}"` }, { status: 400 });
  }

  const now = new Date().toISOString();
  await admin
    .from('import_batch')
    .update({
      status: apply.failed ? 'failed' : 'applied',
      finished_at: now,
      warnings: [...result.report.warnings, ...apply.notes],
    })
    .eq('id', batch?.id ?? '');

  // Freshness is recorded per dataset so every screen can say how old its
  // inputs are, and warn when they are older than the threshold. A failed run
  // records the failure instead: §5.2 says an adapter that could not refresh
  // must be visible, not quietly leave yesterday's timestamp in place.
  await admin.from('dataset_freshness').upsert(
    {
      tenant_id: session.tenantId,
      system_id: 'csv',
      dataset_id: datasetId,
      ...(apply.failed ? {} : { last_success_at: now, data_as_of: dataAsOf }),
      last_attempt_at: now,
      last_error: apply.failed ? apply.notes.join(' · ').slice(0, 2000) : null,
    },
    { onConflict: 'tenant_id,system_id,dataset_id' },
  );

  await admin.from('audit_log').insert({
    tenant_id: session.tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: apply.failed ? 'import.failed' : 'import.apply',
    object_type: 'import_batch',
    object_id: batch?.id ?? datasetId,
    snapshot: {
      datasetId,
      fileName: file.name,
      rowsRead: result.report.rowsRead,
      rowsAccepted: result.report.rowsAccepted,
      rowsRejected: result.report.rowsRejected,
      dataAsOf,
      ...apply,
    },
  });

  if (apply.failed) {
    // A write that failed must never be reported as an import that worked.
    return NextResponse.json(
      { report: result.report, applied: false, ...apply, error: apply.notes.join(' · ') },
      { status: 500 },
    );
  }

  return NextResponse.json({ report: result.report, applied: true, ...apply });
}
