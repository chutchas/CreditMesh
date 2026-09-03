import { NextResponse } from 'next/server';
import {
  applyAlertBudget,
  detectGradeMoves,
  detectRegistryChanges,
  type DetectedChange,
  type GradeMove,
  type RegistrySnapshot,
} from '@creditmesh/core';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Compares the current registry and grade picture against the last snapshot.
 *
 * The alert budget is applied here rather than in the notification layer, so
 * that what was held back is recorded and visible. §7's failure mode for this
 * module is not wrong alerts, it is too many — people switch it off in two
 * weeks and never switch it back on — and a run that silently truncated its
 * own output would be the worse version of the same mistake.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: current }, { data: snapshots }, { data: directors }, { data: parties }, { data: indexRows }] =
    await Promise.all([
      admin
        .from('party_registry_profile')
        .select('party_id, legal_status, registered_capital, registered_address, industry_code, retrieved_at')
        .eq('tenant_id', session.tenantId),
      admin
        .from('party_registry_snapshot')
        .select('party_id, legal_status, registered_capital, registered_address, industry_code, director_names, captured_at')
        .eq('tenant_id', session.tenantId)
        .order('captured_at', { ascending: false }),
      admin
        .from('person_party_role')
        .select('party_id, role, person:person_id(full_name)')
        .eq('tenant_id', session.tenantId)
        .eq('role', 'director'),
      admin.from('party').select('id, legal_name').eq('tenant_id', session.tenantId),
      admin
        .from('risk_index')
        .select('party_id, as_of, score, grade')
        .eq('tenant_id', session.tenantId)
        .order('as_of', { ascending: false }),
    ]);

  const nameByParty = new Map(((parties ?? []) as { id: string; legal_name: string }[]).map((p) => [p.id, p.legal_name]));

  const directorsByParty = new Map<string, string[]>();
  for (const d of (directors ?? []) as unknown as { party_id: string; person: { full_name: string } | null }[]) {
    const bucket = directorsByParty.get(d.party_id) ?? [];
    if (d.person?.full_name) bucket.push(d.person.full_name);
    directorsByParty.set(d.party_id, bucket);
  }

  // Most recent snapshot per party — the state before the latest import.
  const previousByParty = new Map<string, RegistrySnapshot>();
  for (const s of (snapshots ?? []) as Record<string, unknown>[]) {
    const partyId = String(s.party_id);
    if (previousByParty.has(partyId)) continue;
    previousByParty.set(partyId, {
      legalStatus: (s.legal_status as string | null) ?? null,
      registeredCapital: s.registered_capital === null ? null : Number(s.registered_capital),
      registeredAddress: (s.registered_address as string | null) ?? null,
      industryCode: (s.industry_code as string | null) ?? null,
      directorNames: (s.director_names as string[] | null) ?? [],
      capturedAt: String(s.captured_at),
    });
  }

  const changes: DetectedChange[] = [];

  for (const c of (current ?? []) as Record<string, unknown>[]) {
    const partyId = String(c.party_id);
    const after: RegistrySnapshot = {
      legalStatus: (c.legal_status as string | null) ?? null,
      registeredCapital: c.registered_capital === null ? null : Number(c.registered_capital),
      registeredAddress: (c.registered_address as string | null) ?? null,
      industryCode: (c.industry_code as string | null) ?? null,
      directorNames: directorsByParty.get(partyId) ?? [],
      capturedAt: String(c.retrieved_at),
    };
    changes.push(
      ...detectRegistryChanges(
        partyId,
        nameByParty.get(partyId) ?? partyId,
        previousByParty.get(partyId) ?? null,
        after,
        today,
      ),
    );
  }

  /* Grade movement, from the two most recent index runs per counterparty. */
  const byParty = new Map<string, { as_of: string; score: number | null; grade: string | null }[]>();
  for (const r of (indexRows ?? []) as { party_id: string; as_of: string; score: number | null; grade: string | null }[]) {
    const bucket = byParty.get(r.party_id) ?? [];
    bucket.push(r);
    byParty.set(r.party_id, bucket);
  }
  const moves: GradeMove[] = [];
  for (const [partyId, history] of byParty) {
    if (history.length < 2) continue;
    const [now, before] = history;
    moves.push({
      partyId,
      partyName: nameByParty.get(partyId) ?? partyId,
      previousGrade: before!.grade,
      currentGrade: now!.grade,
      previousScore: before!.score === null ? null : Number(before!.score),
      currentScore: now!.score === null ? null : Number(now!.score),
    });
  }

  const gradeRank = new Map(
    [...session.profile.creditPolicy.riskGrades].sort((a, b) => b.minScore - a.minScore).map((g, i) => [g.code, i]),
  );
  changes.push(...detectGradeMoves(moves, gradeRank, today));

  const budget = applyAlertBudget(changes);

  const payload = [...budget.raised, ...budget.digest, ...budget.deferred].map((c) => ({
    tenant_id: session.tenantId,
    party_id: c.partyId,
    code: c.code,
    severity: c.severity,
    actionable: c.actionable,
    before_value: c.before === null ? null : String(c.before),
    after_value: c.after === null ? null : String(c.after),
    detail: c.detail,
    observed_at: c.observedAt,
    notified_at: budget.raised.includes(c) ? new Date().toISOString() : null,
  }));

  if (payload.length > 0) {
    const { error } = await admin
      .from('watchlist_change')
      .upsert(payload, { onConflict: 'tenant_id,party_id,code,observed_at' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // A critical change puts the counterparty on the watchlist automatically, and
  // says which signal did it — never as an anonymous entry somebody has to
  // reverse-engineer later.
  const critical = budget.raised.filter((c) => c.severity === 'critical');
  if (critical.length > 0) {
    const entries = critical.map((c) => ({
      tenant_id: session.tenantId,
      party_id: c.partyId,
      reason: `${c.code}: ${c.detail}`,
      severity: c.severity,
      source: 'signal',
      added_by: session.userId,
    }));
    // Ignore conflicts: a counterparty already on the list stays on it with the
    // reason it was first added for.
    for (const entry of entries) {
      await admin.from('watchlist_entry').insert(entry).select().maybeSingle();
    }
  }

  await admin.from('audit_log').insert({
    tenant_id: session.tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: 'watchlist.run',
    object_type: 'watchlist_change',
    object_id: today,
    snapshot: { raised: budget.raised.length, digest: budget.digest.length, deferred: budget.deferred.length },
  });

  return NextResponse.json({
    ok: true,
    raised: budget.raised.length,
    digest: budget.digest.length,
    deferred: budget.deferred.length,
  });
}
