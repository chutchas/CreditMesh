import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { requireSession } from '../../../lib/session';
import { PageHeader } from '../../../components/ui';
import SimulatorForm from './simulator-form';

export default async function SimulatorPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);

  return (
    <>
      <PageHeader title={t.simulator.title} subtitle={t.simulator.subtitle} />
      <SimulatorForm locale={locale} currency={session.profile.identity.baseCurrency} labels={t.simulator} />
    </>
  );
}
