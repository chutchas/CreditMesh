import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Opens a collection case for every counterparty × entity with an overdue
 * balance, and closes the ones that have paid.
 *
 * Closing is the half people forget, and it is the half that decides whether
 * collectors trust the queue. A case left open after the money arrived puts a
 * paid customer back on someone's call list tomorrow morning.
 *
 * Cases are never deleted — closed ones keep their contact history, which is
 * the record a collector consults the next time the same customer slips.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: items, error }, { data: existing }] = await Promise.all([
    admin
      .from('ar_item')
      .select('party_id, legal_entity_code, due_date, amount_base')
      .eq('tenant_id', session.tenantId)
      .is('cleared_date', null),
    admin
      .from('collection_case')
      .select('id, party_id, legal_entity_code, status')
      .eq('tenant_id', session.tenantId),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const overdueKeys = new Set<string>();
  for (const i of items ?? []) {
    if ((i.due_date as string) >= today) continue;
    overdueKeys.add(`${i.party_id}|${i.legal_entity_code}`);
  }

  const existingByKey = new Map(
    (existing ?? []).map((c) => [`${c.party_id}|${c.legal_entity_code}`, c as { id: string; status: string }]),
  );

  const toOpen: Record<string, unknown>[] = [];
  for (const key of overdueKeys) {
    const current = existingByKey.get(key);
    if (current && current.status !== 'closed') continue;
    const [partyId, legalEntityCode] = key.split('|');
    toOpen.push({
      tenant_id: session.tenantId,
      party_id: partyId,
      legal_entity_code: legalEntityCode,
      status: 'open',
      opened_at: new Date().toISOString(),
      closed_at: null,
    });
  }

  if (toOpen.length > 0) {
    const { error: openError } = await admin
      .from('collection_case')
      .upsert(toOpen, { onConflict: 'tenant_id,party_id,legal_entity_code' });
    if (openError) return NextResponse.json({ error: openError.message }, { status: 500 });
  }

  const toClose = (existing ?? [])
    .filter((c) => c.status === 'open' && !overdueKeys.has(`${c.party_id}|${c.legal_entity_code}`))
    .map((c) => c.id as string);

  if (toClose.length > 0) {
    const { error: closeError } = await admin
      .from('collection_case')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .in('id', toClose);
    if (closeError) return NextResponse.json({ error: closeError.message }, { status: 500 });
  }

  // Promises whose date has passed with the balance still outstanding are
  // broken. Nobody marks these by hand, and a kept-rate that only counts the
  // promises somebody remembered to close is not a metric.
  const { data: duePromises } = await admin
    .from('promise_to_pay')
    .select('id, case_id, promised_date')
    .eq('tenant_id', session.tenantId)
    .eq('status', 'open')
    .lt('promised_date', today);

  const stillOverdueCaseIds = new Set(
    (existing ?? [])
      .filter((c) => overdueKeys.has(`${c.party_id}|${c.legal_entity_code}`))
      .map((c) => c.id as string),
  );
  const broken = (duePromises ?? [])
    .filter((p) => stillOverdueCaseIds.has(p.case_id as string))
    .map((p) => p.id as string);
  const kept = (duePromises ?? [])
    .filter((p) => !stillOverdueCaseIds.has(p.case_id as string))
    .map((p) => p.id as string);

  if (broken.length > 0) {
    await admin
      .from('promise_to_pay')
      .update({ status: 'broken', settled_at: new Date().toISOString() })
      .in('id', broken);
  }
  if (kept.length > 0) {
    await admin
      .from('promise_to_pay')
      .update({ status: 'kept', settled_at: new Date().toISOString() })
      .in('id', kept);
  }

  await admin.from('audit_log').insert({
    tenant_id: session.tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: 'collection.run',
    object_type: 'collection_case',
    object_id: today,
    snapshot: { opened: toOpen.length, closed: toClose.length, promisesBroken: broken.length, promisesKept: kept.length },
  });

  return NextResponse.json({
    ok: true,
    opened: toOpen.length,
    closed: toClose.length,
    promisesBroken: broken.length,
    promisesKept: kept.length,
  });
}
