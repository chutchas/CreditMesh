import { DATASETS } from '@creditmesh/adapters';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { canWrite, requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate } from '../../../lib/format';
import { Card, Empty, PageHeader, Table } from '../../../components/ui';
import ImportPanel from './import-panel';

export default async function ImportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();

  const { data: history } = await supabase
    .from('import_batch')
    .select('id, dataset_id, file_name, status, rows_read, rows_accepted, rows_rejected, data_as_of, started_at')
    .order('started_at', { ascending: false })
    .limit(20);

  const datasets = DATASETS.map((d) => ({
    id: d.datasetId,
    label: locale === 'th' ? d.labelTh : d.labelEn,
    columns: d.columns.map((c) => ({ field: c.canonicalField, required: c.required, aliases: c.aliases.slice(0, 4) })),
  }));

  return (
    <>
      <PageHeader title={t.importer.title} subtitle={t.importer.subtitle} />

      {canWrite(session) ? (
        <ImportPanel datasets={datasets} labels={t.importer} commonLabels={{ noData: t.common.noData }} />
      ) : (
        <Empty title={t.common.noData} hint="read-only role" />
      )}

      <div className="mt-6">
        <Card title={t.importer.history}>
          {(history ?? []).length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">{t.common.never}</p>
          ) : (
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">{t.importer.dataset}</th>
                  <th className="py-2 pr-3 font-medium">file</th>
                  <th className="py-2 pr-3 font-medium">status</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.importer.rowsRead}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.importer.rowsAccepted}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.importer.rowsRejected}</th>
                  <th className="py-2 font-medium">{t.importer.dataAsOf}</th>
                </tr>
              }
            >
              {(history ?? []).map((b) => (
                <tr key={b.id} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="py-2 pr-3">{b.dataset_id}</td>
                  <td className="py-2 pr-3 text-[var(--color-muted)]">{b.file_name ?? '—'}</td>
                  <td className="py-2 pr-3">{b.status}</td>
                  <td className="tabular py-2 pr-3 text-right">{b.rows_read}</td>
                  <td className="tabular py-2 pr-3 text-right">{b.rows_accepted}</td>
                  <td className={`tabular py-2 pr-3 text-right ${b.rows_rejected > 0 ? 'text-[#b54708]' : ''}`}>{b.rows_rejected}</td>
                  <td className="py-2">{formatDate(b.data_as_of, locale)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
