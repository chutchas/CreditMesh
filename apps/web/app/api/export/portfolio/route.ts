import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { createClient } from '../../../../lib/supabase/server';
import { getSession } from '../../../../lib/session';
import { getDictionary } from '../../../../lib/i18n/dictionaries';
import { isLocale } from '../../../../lib/i18n/config';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * NFR §11: every report exports to Excel. This is not a nice-to-have for this
 * audience — they work in spreadsheets and will not trust a system whose
 * numbers they cannot take out and check themselves.
 *
 * Read through the user's own client, so the export contains exactly the rows
 * that user is allowed to see. An export that quietly widens access is the
 * easiest way to leak one BU's balances to another.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const url = new URL(request.url);
  const localeParam = url.searchParams.get('locale') ?? 'th';
  const locale = isLocale(localeParam) ? localeParam : 'th';
  const grade = url.searchParams.get('grade');
  const t = getDictionary(locale);

  const supabase = await createClient();
  let query = supabase
    .from('v_party_portfolio')
    .select(
      'legal_name, tax_id, grade, score, total_exposure, total_ar_overdue, total_credit_limit, utilization_pct, entity_count, latest_fiscal_year, flags, exposure_as_of',
    )
    .order('total_exposure', { ascending: false, nullsFirst: false });
  if (grade) query = query.eq('grade', grade);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const currency = session.profile.identity.baseCurrency;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CreditMesh';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(t.portfolio.title);
  sheet.columns = [
    { header: t.portfolio.legalName, key: 'legal_name', width: 42 },
    { header: t.portfolio.taxId, key: 'tax_id', width: 18 },
    { header: t.portfolio.grade, key: 'grade', width: 8 },
    { header: t.portfolio.score, key: 'score', width: 8 },
    { header: `${t.portfolio.exposure} (${currency})`, key: 'total_exposure', width: 18 },
    { header: `${t.portfolio.overdue} (${currency})`, key: 'total_ar_overdue', width: 18 },
    { header: `${t.portfolio.limit} (${currency})`, key: 'total_credit_limit', width: 18 },
    { header: `${t.portfolio.utilization} %`, key: 'utilization_pct', width: 12 },
    { header: t.portfolio.entities, key: 'entity_count', width: 10 },
    { header: t.portfolio.latestFy, key: 'latest_fiscal_year', width: 10 },
    { header: t.portfolio.flags, key: 'flags', width: 50 },
  ];

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F7' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of data ?? []) {
    const flags = ((row.flags ?? []) as { code: string }[])
      .map((f) => t.flags[f.code as keyof typeof t.flags] ?? f.code)
      .join(' · ');
    sheet.addRow({ ...row, flags });
  }

  for (const key of ['total_exposure', 'total_ar_overdue', 'total_credit_limit']) {
    sheet.getColumn(key).numFmt = '#,##0';
  }
  sheet.getColumn('utilization_pct').numFmt = '0.0';
  sheet.getColumn('score').numFmt = '0.0';
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: sheet.columnCount } };

  // The as-of date travels with the file. A spreadsheet emailed around without
  // one is how a three-month-old number ends up in a board pack.
  const meta = workbook.addWorksheet(t.common.asOf);
  meta.columns = [
    { header: '', key: 'k', width: 28 },
    { header: '', key: 'v', width: 40 },
  ];
  meta.addRows([
    { k: t.common.appName, v: session.tenantName },
    { k: t.common.asOf, v: (data?.[0]?.exposure_as_of as string | null) ?? '—' },
    { k: 'Exported at', v: new Date().toISOString() },
    { k: 'Exported by', v: session.email ?? session.userId },
    { k: t.admin.profileVersion, v: session.profileVersion ?? 'starter defaults' },
    { k: t.portfolio.filterGrade, v: grade ?? t.common.all },
  ]);

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `creditmesh-portfolio-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
