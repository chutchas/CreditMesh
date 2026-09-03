import Link from 'next/link';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate, formatMoney } from '../../../lib/format';
import { Card, PageHeader } from '../../../components/ui';

/**
 * Module 18 — Credit Operations Cockpit.
 *
 * No engine of its own. §7 names the trap this module falls into — a screen
 * built to end dashboard sprawl becomes the twelfth dashboard — and gives the
 * test that avoids it: **every tile must be work somebody has to do.** A number
 * that is merely interesting belongs in a report.
 *
 * So there are no totals here. Total exposure, portfolio value, receivables
 * outstanding: all of them are true, none of them is a task, and all of them
 * live on other screens. Each tile below is a queue with a count, a link to the
 * place the work happens, and nothing when the queue is empty.
 *
 * Tiles appear only when their source module has data. §7's advice is to build
 * the frame early and fill one slot at a time as modules land, rather than
 * shipping a screen full of zeroes that teaches people it is not worth opening.
 */
export default async function CockpitPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const currency = session.profile.identity.baseCurrency;
  const today = new Date().toISOString().slice(0, 10);

  const [
    { data: blocks },
    { data: legalPending },
    { data: exceptions },
    { data: promises },
    { data: changes },
    { data: memos },
    { data: collateral },
    { data: mergeCandidates },
    { data: groupsProposed },
    { data: incompleteIndex },
  ] = await Promise.all([
    supabase.from('v_order_block_open').select('block_id, order_amount, legal_name, order_ref, blocked_at'),
    supabase.from('legal_event').select('id, subject_name, event_type, severity').eq('review_status', 'pending'),
    supabase
      .from('payment_exception')
      .select('id, type, amount, occurred_at, party:party_id(legal_name)')
      .eq('status', 'open'),
    supabase
      .from('promise_to_pay')
      .select('id, amount, promised_date, party:party_id(legal_name)')
      .eq('status', 'open')
      .lte('promised_date', today),
    supabase
      .from('watchlist_change')
      .select('id, code, detail, party:party_id(legal_name)')
      .eq('actionable', true)
      .is('acknowledged_at', null),
    supabase.from('credit_memo').select('id, party:party_id(legal_name)').eq('status', 'draft'),
    supabase
      .from('collateral')
      .select('id, reference, expiry_date, amount, party:party_id(legal_name)')
      .eq('status', 'active')
      .eq('direction', 'inbound')
      .not('expiry_date', 'is', null)
      .order('expiry_date'),
    supabase.from('party_merge_candidate').select('id').eq('status', 'pending'),
    supabase.from('party_group').select('id, name, member_count').eq('status', 'proposed'),
    supabase.from('v_risk_index_current').select('party_id, incomplete, blocked_by'),
  ]);

  const expiryBands = session.profile.collateralPolicy.expiryAlertDays ?? [30];
  const horizon = Math.max(...expiryBands, 30);
  const expiring = ((collateral ?? []) as unknown as {
    id: string;
    reference: string;
    expiry_date: string;
    amount: number;
    party: { legal_name: string } | null;
  }[]).filter((c) => {
    const days = Math.round((Date.parse(c.expiry_date) - Date.parse(today)) / 86_400_000);
    return days <= horizon;
  });

  const blockRows = (blocks ?? []) as { block_id: string; order_amount: number; legal_name: string; order_ref: string; blocked_at: string }[];
  const exceptionRows = (exceptions ?? []) as unknown as {
    id: string;
    type: string;
    amount: number;
    occurred_at: string;
    party: { legal_name: string } | null;
  }[];
  const promiseRows = (promises ?? []) as unknown as {
    id: string;
    amount: number;
    promised_date: string;
    party: { legal_name: string } | null;
  }[];
  const changeRows = (changes ?? []) as unknown as {
    id: string;
    code: string;
    detail: string;
    party: { legal_name: string } | null;
  }[];
  const legalRows = (legalPending ?? []) as { id: string; subject_name: string; event_type: string; severity: string }[];
  const memoRows = (memos ?? []) as unknown as { id: string; party: { legal_name: string } | null }[];
  const groupRows = (groupsProposed ?? []) as { id: string; name: string; member_count: number }[];
  const indexRows = (incompleteIndex ?? []) as { party_id: string; incomplete: boolean; blocked_by: string | null }[];

  interface Tile {
    key: string;
    title: string;
    count: number;
    href: string;
    note: string | null;
    lines: string[];
    tone: 'urgent' | 'attention' | 'routine';
  }

  const tiles: Tile[] = [];

  if (blockRows.length > 0) {
    tiles.push({
      key: 'orders',
      title: t.cockpit.heldOrders,
      count: blockRows.length,
      href: `/${locale}/orders`,
      note: formatMoney(
        blockRows.reduce((s, b) => s + Number(b.order_amount), 0),
        currency,
        locale,
        { compact: true },
      ),
      lines: blockRows.slice(0, 4).map((b) => `${b.order_ref} · ${b.legal_name}`),
      tone: 'urgent',
    });
  }

  if (promiseRows.length > 0) {
    tiles.push({
      key: 'promises',
      title: t.cockpit.promisesDue,
      count: promiseRows.length,
      href: `/${locale}/collection`,
      note: formatMoney(
        promiseRows.reduce((s, p) => s + Number(p.amount), 0),
        currency,
        locale,
        { compact: true },
      ),
      lines: promiseRows
        .slice(0, 4)
        .map((p) => `${p.party?.legal_name ?? ''} · ${formatDate(p.promised_date, locale)}`),
      tone: 'urgent',
    });
  }

  if (exceptionRows.length > 0) {
    tiles.push({
      key: 'exceptions',
      title: t.cockpit.openExceptions,
      count: exceptionRows.length,
      href: `/${locale}/exceptions`,
      note: formatMoney(
        exceptionRows.reduce((s, e) => s + Number(e.amount), 0),
        currency,
        locale,
        { compact: true },
      ),
      lines: exceptionRows
        .slice(0, 4)
        .map((e) => `${t.exceptionTypes[e.type as keyof typeof t.exceptionTypes] ?? e.type} · ${e.party?.legal_name ?? ''}`),
      tone: 'urgent',
    });
  }

  if (changeRows.length > 0) {
    tiles.push({
      key: 'signals',
      title: t.cockpit.newSignals,
      count: changeRows.length,
      href: `/${locale}/watchlist`,
      note: null,
      lines: changeRows
        .slice(0, 4)
        .map((c) => `${c.party?.legal_name ?? ''} · ${t.changeCodes[c.code as keyof typeof t.changeCodes] ?? c.code}`),
      tone: 'attention',
    });
  }

  if (legalRows.length > 0) {
    tiles.push({
      key: 'legal',
      title: t.cockpit.legalToReview,
      count: legalRows.length,
      href: `/${locale}/legal`,
      note: null,
      lines: legalRows
        .slice(0, 4)
        .map((e) => `${e.subject_name} · ${t.legalTypes[e.event_type as keyof typeof t.legalTypes] ?? e.event_type}`),
      tone: 'attention',
    });
  }

  if (expiring.length > 0) {
    tiles.push({
      key: 'collateral',
      title: t.cockpit.collateralExpiring,
      count: expiring.length,
      href: `/${locale}/collateral`,
      note: formatMoney(
        expiring.reduce((s, c) => s + Number(c.amount), 0),
        currency,
        locale,
        { compact: true },
      ),
      lines: expiring.slice(0, 4).map((c) => `${c.reference} · ${formatDate(c.expiry_date, locale)}`),
      tone: 'attention',
    });
  }

  if (groupRows.length > 0 || (mergeCandidates ?? []).length > 0) {
    tiles.push({
      key: 'groups',
      title: t.cockpit.groupsToConfirm,
      count: groupRows.length + (mergeCandidates ?? []).length,
      href: `/${locale}/groups`,
      note: null,
      lines: groupRows.slice(0, 4).map((g) => `${g.name} · ${g.member_count}`),
      tone: 'routine',
    });
  }

  if (memoRows.length > 0) {
    tiles.push({
      key: 'memos',
      title: t.cockpit.memoDrafts,
      count: memoRows.length,
      href: `/${locale}/memo`,
      note: null,
      lines: memoRows.slice(0, 4).map((m) => m.party?.legal_name ?? ''),
      tone: 'routine',
    });
  }

  const indexProblems = indexRows.filter((r) => r.incomplete || r.blocked_by);
  if (indexProblems.length > 0) {
    tiles.push({
      key: 'index',
      title: t.cockpit.incompleteScores,
      count: indexProblems.length,
      href: `/${locale}/risk-index`,
      note: null,
      lines: [],
      tone: 'routine',
    });
  }

  const toneClass = (tone: Tile['tone']) =>
    tone === 'urgent'
      ? 'border-[#fda29b] bg-[#fffbfa]'
      : tone === 'attention'
        ? 'border-[#fedf89] bg-[#fffcf5]'
        : 'border-[var(--color-line)] bg-[var(--color-surface)]';

  return (
    <>
      <PageHeader title={t.cockpit.title} subtitle={t.cockpit.subtitle} />

      {tiles.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-[var(--color-muted)]">{t.cockpit.allClear}</p>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {tiles.map((tile) => (
            <Link
              key={tile.key}
              href={tile.href}
              className={`block rounded-lg border p-4 transition hover:shadow-sm ${toneClass(tile.tone)}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{tile.title}</span>
                <span className="tabular text-2xl font-semibold">{tile.count}</span>
              </div>
              {tile.note ? <div className="tabular mt-0.5 text-xs text-[var(--color-muted)]">{tile.note}</div> : null}
              {tile.lines.length > 0 ? (
                <ul className="mt-2 space-y-0.5 border-t border-[var(--color-line)] pt-2 text-[11px] text-[var(--color-muted)]">
                  {tile.lines.map((line) => (
                    <li key={line} className="truncate">
                      {line}
                    </li>
                  ))}
                  {tile.count > tile.lines.length ? <li>+{tile.count - tile.lines.length}</li> : null}
                </ul>
              ) : null}
            </Link>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-[var(--color-muted)]">{t.cockpit.designNote}</p>
    </>
  );
}
