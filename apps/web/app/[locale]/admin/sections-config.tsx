'use client';

import {
  ArrayEditor,
  Field,
  ListInput,
  NumberInput,
  Select,
  TextInput,
  Toggle,
} from '../../../components/form';
import type { SectionProps } from './shared';

/* §4.1 ------------------------------------------------------------------- */

export function IdentitySection({ profile, update, say, disabled }: SectionProps) {
  const identity = profile.identity;
  const set = (patch: Partial<typeof identity>) => update({ identity: { ...identity, ...patch } });

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={say('ชื่อองค์กร', 'Organisation name')}>
        <TextInput value={identity.displayName} disabled={disabled} onChange={(v) => set({ displayName: v })} />
      </Field>
      <Field
        label={say('สกุลเงินหลัก', 'Base currency')}
        hint={say('ทุกยอดรวมและทุกรายงานใช้สกุลนี้', 'Every total and report is expressed in this currency')}
      >
        <TextInput value={identity.baseCurrency} disabled={disabled} onChange={(v) => set({ baseCurrency: v.toUpperCase().slice(0, 3) })} mono />
      </Field>
      <Field
        label={say('สกุลเงินอื่นที่ใช้', 'Additional currencies')}
        hint={say('บรรทัดละหนึ่งรหัส ISO', 'One ISO code per line')}
      >
        <ListInput value={identity.additionalCurrencies} disabled={disabled} onChange={(v) => set({ additionalCurrencies: v.map((c) => c.toUpperCase()) })} />
      </Field>
      <Field label={say('ภาษาเริ่มต้น', 'Default locale')}>
        <Select
          value={identity.locale}
          disabled={disabled}
          onChange={(v) => set({ locale: v })}
          options={[
            { value: 'th-TH', label: 'ไทย (th-TH)' },
            { value: 'en-US', label: 'English (en-US)' },
          ]}
        />
      </Field>
      <Field label={say('เขตเวลา', 'Timezone')}>
        <TextInput value={identity.timezone} disabled={disabled} onChange={(v) => set({ timezone: v })} mono />
      </Field>
      <Field
        label={say('วันเริ่มปีบัญชี', 'Fiscal year start')}
        hint={say('รูปแบบ MM-DD', 'Format MM-DD')}
      >
        <TextInput value={identity.fiscalYearStart} disabled={disabled} onChange={(v) => set({ fiscalYearStart: v })} mono />
      </Field>
      <Field label={say('รูปแบบตัวเลข', 'Number format')}>
        <Select
          value={identity.numberFormat}
          disabled={disabled}
          onChange={(v) => set({ numberFormat: v })}
          options={[
            { value: '1,234.56', label: '1,234.56' },
            { value: '1.234,56', label: '1.234,56' },
          ]}
        />
      </Field>
      <Field label={say('รูปแบบวันที่', 'Date format')}>
        <Select
          value={identity.dateFormat}
          disabled={disabled}
          onChange={(v) => set({ dateFormat: v })}
          options={[
            { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
            { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
            { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
          ]}
        />
      </Field>
      <Field
        label={say('วันที่มีผลของ profile นี้', 'Effective from')}
        hint={say('ใช้บันทึกว่าการตั้งค่าชุดนี้เริ่มใช้เมื่อใด', 'Records when this configuration takes effect')}
      >
        <input
          type="date"
          value={profile.effectiveFrom}
          disabled={disabled}
          onChange={(e) => update({ effectiveFrom: e.target.value })}
          className="w-full rounded border border-[var(--color-line)] bg-white px-2 py-1.5 text-sm"
        />
      </Field>
    </div>
  );
}

/* §4.2 ------------------------------------------------------------------- */

export function EntitiesSection({ profile, update, say, disabled }: SectionProps) {
  return (
    <>
      <p className="mb-3 text-xs text-[var(--color-muted)]">
        {say(
          'รองรับหลายชั้น เพราะบางกลุ่มมี BU ซ้อนใต้บริษัท และบางกลุ่มมีบริษัทซ้อนใต้ BU — นิติบุคคลที่เอาออกจะถูกปิดใช้งาน ไม่ลบ เพราะรายการลูกหนี้และหลักประกันยังอ้างถึงอยู่',
          'Nesting works in both directions: some groups put BUs under companies, others the reverse. An entity removed here is deactivated, never deleted — receivables and collateral still point at it.',
        )}
      </p>
      <ArrayEditor
        items={profile.legalEntities}
        disabled={disabled}
        minItems={1}
        onChange={(legalEntities) => update({ legalEntities })}
        makeEmpty={() => ({
          code: '',
          displayName: '',
          currency: profile.identity.baseCurrency,
          parentGroup: null,
          sourceSystemRef: [],
          creditSegmentRef: null,
          isActive: true,
        })}
        addLabel={say('เพิ่มนิติบุคคล', 'Add entity')}
        removeLabel={say('เอาออก', 'Remove')}
        emptyLabel={say('ต้องมีอย่างน้อยหนึ่งนิติบุคคล', 'At least one entity is required')}
        renderRow={(entity, patch) => (
          <>
            <Field label={say('รหัส', 'Code')}>
              <TextInput value={entity.code} disabled={disabled} onChange={(v) => patch({ code: v })} mono />
            </Field>
            <Field label={say('ชื่อที่แสดง', 'Display name')}>
              <TextInput value={entity.displayName} disabled={disabled} onChange={(v) => patch({ displayName: v })} />
            </Field>
            <Field label={say('สกุลเงิน', 'Currency')}>
              <TextInput value={entity.currency} disabled={disabled} onChange={(v) => patch({ currency: v.toUpperCase().slice(0, 3) })} mono />
            </Field>
            <Field label={say('อยู่ใต้', 'Parent')}>
              <Select
                value={entity.parentGroup ?? ''}
                disabled={disabled}
                onChange={(v) => patch({ parentGroup: v === '' ? null : v })}
                options={[
                  { value: '', label: say('— ไม่มี —', '— none —') },
                  ...profile.legalEntities
                    .filter((e) => e.code !== entity.code && e.code !== '')
                    .map((e) => ({ value: e.code, label: `${e.code} · ${e.displayName}` })),
                ]}
              />
            </Field>
            <Field
              label={say('รหัสในระบบต้นทาง', 'Source system codes')}
              hint={say('บรรทัดละหนึ่งรหัส', 'One code per line')}
            >
              <ListInput value={entity.sourceSystemRef} disabled={disabled} onChange={(v) => patch({ sourceSystemRef: v })} />
            </Field>
            <Field label={say('สถานะ', 'Status')}>
              <Toggle
                checked={entity.isActive}
                disabled={disabled}
                onChange={(v) => patch({ isActive: v })}
                label={say('ใช้งานอยู่', 'Active')}
              />
            </Field>
          </>
        )}
      />
    </>
  );
}

/* §4.3 ------------------------------------------------------------------- */

export function SourcesSection({ profile, update, say, disabled }: SectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('ระบบต้นทาง', 'Source systems')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'credential ไม่เก็บในไฟล์นี้ — ช่องนี้ชี้ไปที่ secret store เท่านั้น',
            'Credentials never live in the profile; this field points at the secret store.',
          )}
        </p>
        <ArrayEditor
          items={profile.sourceSystems}
          disabled={disabled}
          onChange={(sourceSystems) => update({ sourceSystems })}
          makeEmpty={() => ({
            systemId: '',
            type: 'csv' as const,
            adapterVersion: '1',
            connectionProfileRef: null,
            syncSchedule: null,
            entityScope: [],
          })}
          addLabel={say('เพิ่มระบบต้นทาง', 'Add source system')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ยังไม่มีระบบต้นทาง', 'No source systems yet')}
          renderRow={(system, patch) => (
            <>
              <Field label={say('รหัสระบบ', 'System id')}>
                <TextInput value={system.systemId} disabled={disabled} onChange={(v) => patch({ systemId: v })} mono />
              </Field>
              <Field label={say('ประเภท', 'Type')}>
                <Select
                  value={system.type}
                  disabled={disabled}
                  onChange={(v) => patch({ type: v })}
                  options={[
                    { value: 'csv' as const, label: say('ไฟล์ CSV / Excel', 'CSV / Excel upload') },
                    { value: 'rest' as const, label: 'REST API' },
                    { value: 'warehouse' as const, label: say('คลังข้อมูล', 'Data warehouse') },
                    { value: 'erp_a' as const, label: say('ERP หลัก', 'Primary ERP') },
                    { value: 'erp_b' as const, label: say('ERP รอง', 'Secondary ERP') },
                  ]}
                />
              </Field>
              <Field label={say('เวอร์ชัน adapter', 'Adapter version')}>
                <TextInput value={system.adapterVersion} disabled={disabled} onChange={(v) => patch({ adapterVersion: v })} mono />
              </Field>
              <Field label={say('อ้างอิง credential', 'Credential reference')}>
                <TextInput
                  value={system.connectionProfileRef ?? ''}
                  disabled={disabled}
                  onChange={(v) => patch({ connectionProfileRef: v === '' ? null : v })}
                  placeholder="secret://…"
                  mono
                />
              </Field>
              <Field label={say('ตารางเวลาดึงข้อมูล', 'Sync schedule')}>
                <TextInput
                  value={system.syncSchedule ?? ''}
                  disabled={disabled}
                  onChange={(v) => patch({ syncSchedule: v === '' ? null : v })}
                  placeholder="0 2 * * *"
                  mono
                />
              </Field>
              <Field
                label={say('ดึงข้อมูลของนิติบุคคล', 'Entity scope')}
                hint={say('เว้นว่าง = ทุกนิติบุคคล', 'Empty means every entity')}
              >
                <ListInput value={system.entityScope} disabled={disabled} onChange={(v) => patch({ entityScope: v })} />
              </Field>
            </>
          )}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('การจับคู่ field', 'Field mapping')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'สำคัญกว่าที่คิด องค์กรที่ใช้ ERP ยี่ห้อเดียวกันมักเก็บเลขผู้เสียภาษีคนละ field และตั้งรหัสลูกค้าไม่เหมือนกัน — เว้นว่างไว้ได้ ตัวนำเข้า CSV จะเดาจากชื่อคอลัมน์ให้เอง',
            'This matters more than it looks: organisations on the same ERP keep the taxpayer id in different fields and number their customers differently. Leave it empty and the CSV importer guesses from the column headers.',
          )}
        </p>
        <ArrayEditor
          items={profile.fieldMappings}
          disabled={disabled}
          onChange={(fieldMappings) => update({ fieldMappings })}
          makeEmpty={() => ({ canonicalField: '', sourcePath: '', transform: 'none' as const, transformArg: null, required: false })}
          addLabel={say('เพิ่มการจับคู่', 'Add mapping')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ยังไม่มีการจับคู่แบบกำหนดเอง — ใช้การเดาจากหัวคอลัมน์', 'No explicit mappings — header matching is used')}
          renderRow={(mapping, patch) => (
            <>
              <Field label={say('field ในแพลตฟอร์ม', 'Canonical field')}>
                <TextInput value={mapping.canonicalField} disabled={disabled} onChange={(v) => patch({ canonicalField: v })} mono />
              </Field>
              <Field label={say('คอลัมน์/เส้นทางต้นทาง', 'Source path')}>
                <TextInput value={mapping.sourcePath} disabled={disabled} onChange={(v) => patch({ sourcePath: v })} mono />
              </Field>
              <Field label={say('การแปลงค่า', 'Transform')}>
                <Select
                  value={mapping.transform}
                  disabled={disabled}
                  onChange={(v) => patch({ transform: v })}
                  options={[
                    { value: 'none' as const, label: say('ไม่แปลง', 'None') },
                    { value: 'trim' as const, label: 'trim' },
                    { value: 'pad' as const, label: 'pad' },
                    { value: 'regex' as const, label: 'regex' },
                    { value: 'lookup' as const, label: 'lookup' },
                  ]}
                />
              </Field>
              <Field label={say('พารามิเตอร์', 'Transform argument')}>
                <TextInput
                  value={mapping.transformArg ?? ''}
                  disabled={disabled}
                  onChange={(v) => patch({ transformArg: v === '' ? null : v })}
                  mono
                />
              </Field>
              <Field label={say('บังคับ', 'Required')}>
                <Toggle
                  checked={mapping.required}
                  disabled={disabled}
                  onChange={(v) => patch({ required: v })}
                  label={say('ต้องมีค่าเสมอ', 'Must always be present')}
                />
              </Field>
            </>
          )}
        />
      </div>
    </div>
  );
}

/* §4.4 ------------------------------------------------------------------- */

const DATASETS = ['financial_statement', 'shareholder', 'director', 'status', 'litigation'] as const;

export function EnrichmentSection({ profile, update, say, disabled }: SectionProps) {
  return (
    <>
      <p className="mb-3 text-xs text-[var(--color-muted)]">
        {say(
          'ข้อมูลนิติบุคคลเป็นของผู้ให้บริการ แพลตฟอร์มไม่ขายต่อข้อมูล แต่ละองค์กรใส่บัญชีของตัวเอง ระบบเรียกใช้ในนามเขา และค่าข้อมูลเป็นของเขา — โควตาต่อวันมีไว้คุมค่าใช้จ่ายขององค์กรเอง',
          'Company data belongs to its provider. The platform never resells it: each organisation supplies its own account, calls are made on their behalf, and the cost is theirs. The daily quota exists to cap that cost.',
        )}
      </p>
      <ArrayEditor
        items={profile.enrichmentProviders}
        disabled={disabled}
        onChange={(enrichmentProviders) => update({ enrichmentProviders })}
        makeEmpty={() => ({
          providerId: 'manual_upload',
          credentialRef: null,
          enabledDatasets: [],
          quotaPerDay: null,
          cacheTtlDays: 90,
        })}
        addLabel={say('เพิ่มผู้ให้บริการ', 'Add provider')}
        removeLabel={say('เอาออก', 'Remove')}
        emptyLabel={say('ยังไม่มีผู้ให้บริการ — ใช้การอัปโหลดเองได้', 'No providers configured — manual upload still works')}
        renderRow={(provider, patch) => (
          <>
            <Field label={say('ผู้ให้บริการ', 'Provider')}>
              <TextInput value={provider.providerId} disabled={disabled} onChange={(v) => patch({ providerId: v })} mono />
            </Field>
            <Field label={say('อ้างอิง credential', 'Credential reference')}>
              <TextInput
                value={provider.credentialRef ?? ''}
                disabled={disabled}
                onChange={(v) => patch({ credentialRef: v === '' ? null : v })}
                placeholder="secret://…"
                mono
              />
            </Field>
            <Field
              label={say('โควตาต่อวัน', 'Calls per day')}
              hint={say('เว้นว่าง = ไม่จำกัด', 'Empty means unlimited')}
            >
              <TextInput
                value={provider.quotaPerDay === null ? '' : String(provider.quotaPerDay)}
                disabled={disabled}
                onChange={(v) => patch({ quotaPerDay: v === '' ? null : Number(v) })}
                mono
              />
            </Field>
            <Field
              label={say('เก็บข้อมูลไว้กี่วัน', 'Cache TTL (days)')}
              hint={say('ข้อมูลนิติบุคคลไม่ต้องดึงทุกวัน', 'Company records do not change daily')}
            >
              <NumberInput value={provider.cacheTtlDays} min={1} disabled={disabled} onChange={(v) => patch({ cacheTtlDays: v })} />
            </Field>
            <Field label={say('ชุดข้อมูลที่เปิดใช้', 'Enabled datasets')} wide>
              <span className="flex flex-wrap gap-x-4 gap-y-1.5">
                {DATASETS.map((dataset) => (
                  <label key={dataset} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={provider.enabledDatasets.includes(dataset)}
                      onChange={(e) =>
                        patch({
                          enabledDatasets: e.target.checked
                            ? [...provider.enabledDatasets, dataset]
                            : provider.enabledDatasets.filter((d) => d !== dataset),
                        })
                      }
                    />
                    {dataset}
                  </label>
                ))}
              </span>
            </Field>
          </>
        )}
      />
    </>
  );
}
