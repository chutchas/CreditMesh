import { NextResponse } from 'next/server';
import { memoIsReviewable, type CreditMemo } from '@creditmesh/core';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Saves the analyst's own sections, and marks the memo reviewed.
 *
 * A memo whose analyst sections are still empty cannot be marked reviewed. It
 * is a printout of the database until somebody has written the assessment, and
 * letting it through review would erase the distinction the module is built
 * around within a month.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const { memoId, analystSections, markReviewed } = (await request.json().catch(() => ({}))) as {
    memoId?: string;
    analystSections?: { code: string; prompt: string; content: string }[];
    markReviewed?: boolean;
  };
  if (!memoId || !Array.isArray(analystSections)) {
    return NextResponse.json({ error: 'memoId and analystSections are required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: memo, error } = await admin
    .from('credit_memo')
    .select('id, tenant_id, party_id, status')
    .eq('id', memoId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!memo || memo.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'memo not found' }, { status: 404 });
  }

  const patch: Record<string, unknown> = { analyst_sections: analystSections };

  if (markReviewed) {
    const check = memoIsReviewable({ analystSections } as CreditMemo);
    if (!check.ok) {
      return NextResponse.json(
        { error: 'these sections are still empty', missing: check.missing },
        { status: 422 },
      );
    }
    patch.status = 'reviewed';
    patch.reviewed_by = session.userId;
    patch.reviewed_at = new Date().toISOString();
  }

  const { error: updateError } = await admin.from('credit_memo').update(patch).eq('id', memoId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  if (markReviewed) {
    await admin.from('audit_log').insert({
      tenant_id: session.tenantId,
      actor: session.userId,
      actor_label: session.email,
      action: 'memo.reviewed',
      object_type: 'credit_memo',
      object_id: memoId,
      snapshot: { partyId: memo.party_id, analystSections },
    });
  }

  return NextResponse.json({ ok: true });
}
