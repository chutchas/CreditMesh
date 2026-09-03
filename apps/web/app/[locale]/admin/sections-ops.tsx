'use client';

import {
  ArrayEditor,
  CheckboxGroup,
  ColorInput,
  Field,
  ListInput,
  NumberInput,
  Select,
  TextInput,
} from '../../../components/form';
import type { SectionProps } from './shared';

/* §4.8 ------------------------------------------------------------------- */

const PERMISSIONS = ['*', 'read:all', 'read:own_entity', 'read:audit', 'write:assessment', 'write:collateral', 'write:import'] as const;

export function WorkflowSection({ profile, update, say, disabled }: SectionProps) {
  const workflow = profile.workflow;
  const set = (patch: Partial<typeof workflow>) => update({ workflow: { ...workflow, ...patch } });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('บทบาท', 'Roles')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'ขอบเขตนิติบุคคลที่เว้นว่าง = เห็นทุกนิติบุคคล ซึ่งเป็นสิทธิ์ของหน่วยงานส่วนกลาง — การเปิดให้ทุก BU เห็นยอดของกันและกันเป็นเรื่องอ่อนไหวในหลายองค์กร ค่าเริ่มต้นจึงเป็นแบบแคบ',
            'An empty entity scope means every entity, which is a central-credit privilege. Letting every BU see every other BU’s balances is politically sensitive in most groups, so the default is the narrow one.',
          )}
        </p>
        <ArrayEditor
          items={workflow.roles}
          disabled={disabled}
          minItems={1}
          onChange={(roles) => set({ roles })}
          makeEmpty={() => ({ code: '', label: '', permissions: ['read:own_entity'], entityScope: [] })}
          addLabel={say('เพิ่มบทบาท', 'Add role')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ต้องมีอย่างน้อยหนึ่งบทบาท', 'At least one role is required')}
          renderRow={(role, patch) => (
            <>
              <Field label={say('รหัสบทบาท', 'Code')}>
                <TextInput value={role.code} disabled={disabled} onChange={(v) => patch({ code: v })} mono />
              </Field>
              <Field label={say('ชื่อบทบาท', 'Label')}>
                <TextInput value={role.label} disabled={disabled} onChange={(v) => patch({ label: v })} />
              </Field>
              <Field
                label={say('ขอบเขตนิติบุคคล', 'Entity scope')}
                hint={say('เว้นว่าง = ทุกนิติบุคคล', 'Empty means every entity')}
              >
                <ListInput value={role.entityScope} disabled={disabled} onChange={(v) => patch({ entityScope: v })} />
              </Field>
              <Field label={say('สิทธิ์', 'Permissions')} wide>
                <CheckboxGroup
                  value={role.permissions}
                  disabled={disabled}
                  onChange={(permissions) => patch({ permissions })}
                  options={PERMISSIONS.map((p) => ({ value: p, label: p }))}
                />
              </Field>
            </>
          )}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('สายอนุมัติ', 'Approval chains')}</h3>
        <ArrayEditor
          items={workflow.approvalChains}
          disabled={disabled}
          onChange={(approvalChains) => set({ approvalChains })}
          makeEmpty={() => ({ requestType: '', steps: [] })}
          addLabel={say('เพิ่มสายอนุมัติ', 'Add chain')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ยังไม่ได้กำหนด', 'Not configured')}
          renderRow={(chain, patch) => (
            <>
              <Field label={say('ประเภทคำขอ', 'Request type')}>
                <TextInput value={chain.requestType} disabled={disabled} onChange={(v) => patch({ requestType: v })} mono />
              </Field>
              <Field label={say('ลำดับผู้อนุมัติ', 'Steps')} hint={say('บทบาท บรรทัดละหนึ่ง ตามลำดับ', 'Roles in order, one per line')} wide>
                <ListInput value={chain.steps} disabled={disabled} onChange={(v) => patch({ steps: v })} />
              </Field>
            </>
          )}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('เป้าหมายเวลาให้บริการ', 'SLA targets')}</h3>
        <ArrayEditor
          items={workflow.slaTargets}
          disabled={disabled}
          onChange={(slaTargets) => set({ slaTargets })}
          makeEmpty={() => ({ requestType: '', businessDays: 3 })}
          addLabel={say('เพิ่มเป้าหมาย', 'Add target')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ยังไม่ได้กำหนด', 'Not configured')}
          renderRow={(target, patch) => (
            <>
              <Field label={say('ประเภทคำขอ', 'Request type')}>
                <TextInput value={target.requestType} disabled={disabled} onChange={(v) => patch({ requestType: v })} mono />
              </Field>
              <Field label={say('ภายในกี่วันทำการ', 'Business days')}>
                <NumberInput value={target.businessDays} min={1} disabled={disabled} onChange={(v) => patch({ businessDays: v })} />
              </Field>
            </>
          )}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('การมอบอำนาจแทน', 'Delegation')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say('ใช้เมื่อผู้อนุมัติไม่อยู่', 'Used when an approver is away')}
        </p>
        <ArrayEditor
          items={workflow.delegationRules}
          disabled={disabled}
          onChange={(delegationRules) => set({ delegationRules })}
          makeEmpty={() => ({ fromRole: '', toRole: '' })}
          addLabel={say('เพิ่มกฎ', 'Add rule')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ยังไม่ได้กำหนด', 'Not configured')}
          renderRow={(rule, patch) => (
            <>
              <Field label={say('จากบทบาท', 'From role')}>
                <Select
                  value={rule.fromRole}
                  disabled={disabled}
                  onChange={(v) => patch({ fromRole: v })}
                  options={[
                    { value: '', label: say('— เลือก —', '— select —') },
                    ...workflow.roles.map((r) => ({ value: r.code, label: r.code })),
                  ]}
                />
              </Field>
              <Field label={say('ไปยังบทบาท', 'To role')}>
                <Select
                  value={rule.toRole}
                  disabled={disabled}
                  onChange={(v) => patch({ toRole: v })}
                  options={[
                    { value: '', label: say('— เลือก —', '— select —') },
                    ...workflow.roles.map((r) => ({ value: r.code, label: r.code })),
                  ]}
                />
              </Field>
            </>
          )}
        />
      </div>
    </div>
  );
}

/* §4.9 ------------------------------------------------------------------- */

const CHANNELS = ['email', 'teams', 'line', 'webhook'] as const;

export function NotificationSection({ profile, update, say, disabled }: SectionProps) {
  const notification = profile.notification;
  const set = (patch: Partial<typeof notification>) => update({ notification: { ...notification, ...patch } });

  return (
    <div className="space-y-5">
      <Field label={say('ช่องทาง', 'Channels')} wide>
        <CheckboxGroup
          value={notification.channels}
          disabled={disabled}
          onChange={(channels) => set({ channels })}
          options={CHANNELS.map((c) => ({ value: c, label: c }))}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={say('ระดับรายละเอียดที่ส่งออก', 'Detail level')}
          hint={say(
            '"ลิงก์อย่างเดียว" มีไว้สำหรับองค์กรที่ห้ามข้อมูลคู่สัญญาออกไปอยู่ในแอปแชท — ส่งแค่ว่ามีเรื่องต้องดู แล้วให้เข้ามาดูในระบบ',
            '"Link only" exists for organisations that forbid counterparty data in chat apps: it says there is something to look at, and nothing else.',
          )}
        >
          <Select
            value={notification.detailLevel}
            disabled={disabled}
            onChange={(v) => set({ detailLevel: v })}
            options={[
              { value: 'full' as const, label: say('เต็มรูปแบบ', 'Full') },
              { value: 'summary' as const, label: say('สรุป', 'Summary') },
              { value: 'link_only' as const, label: say('ลิงก์อย่างเดียว', 'Link only') },
            ]}
          />
        </Field>
        <Field label={say('สรุปรวมส่งเมื่อ', 'Digest schedule')} hint="cron">
          <TextInput
            value={notification.digestSchedule ?? ''}
            disabled={disabled}
            onChange={(v) => set({ digestSchedule: v === '' ? null : v })}
            placeholder="0 8 * * 1"
            mono
          />
        </Field>
        <Field label={say('งดแจ้งเตือนตั้งแต่', 'Quiet hours from')}>
          <TextInput
            value={notification.quietHours?.from ?? ''}
            disabled={disabled}
            onChange={(v) =>
              set({ quietHours: v === '' ? null : { from: v, to: notification.quietHours?.to ?? '08:00' } })
            }
            placeholder="20:00"
            mono
          />
        </Field>
        <Field label={say('ถึง', 'Quiet hours to')}>
          <TextInput
            value={notification.quietHours?.to ?? ''}
            disabled={disabled || notification.quietHours === null}
            onChange={(v) =>
              set({ quietHours: notification.quietHours ? { ...notification.quietHours, to: v } : null })
            }
            placeholder="08:00"
            mono
          />
        </Field>
      </div>

      <p className="text-xs text-[var(--color-muted)]">
        {say(
          'คุมปริมาณอย่างเข้มงวด เริ่มจากเตือนเฉพาะเหตุการณ์ที่ต้องลงมือทำจริง ถ้าเตือนมากเกินไปผู้ใช้จะปิดภายในสองสัปดาห์และไม่กลับมาเปิดอีก',
          'Keep the volume ruthlessly low. Start with events that require someone to act. Too many alerts and people switch them off inside a fortnight and never switch them back on.',
        )}
      </p>
    </div>
  );
}

/* §4.10 ------------------------------------------------------------------ */

export function BrandingSection({ profile, update, say, disabled }: SectionProps) {
  const branding = profile.branding;
  const set = (patch: Partial<typeof branding>) => update({ branding: { ...branding, ...patch } });
  const templateKeys = Object.keys(branding.documentTemplates);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={say('สีหลัก', 'Primary colour')}>
          <ColorInput value={branding.primaryColor} disabled={disabled} onChange={(v) => set({ primaryColor: v })} />
        </Field>
        <Field label={say('ลิงก์โลโก้', 'Logo URL')}>
          <TextInput
            value={branding.logoUrl ?? ''}
            disabled={disabled}
            onChange={(v) => set({ logoUrl: v === '' ? null : v })}
            mono
          />
        </Field>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('แม่แบบเอกสาร', 'Document templates')}</h3>
        <ArrayEditor
          items={templateKeys.map((key) => ({ key, value: branding.documentTemplates[key] ?? '' }))}
          disabled={disabled}
          onChange={(rows) =>
            set({
              documentTemplates: Object.fromEntries(
                rows.filter((r) => r.key !== '').map((r) => [r.key, r.value]),
              ),
            })
          }
          makeEmpty={() => ({ key: '', value: '' })}
          addLabel={say('เพิ่มแม่แบบ', 'Add template')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ยังไม่มีแม่แบบ', 'No templates yet')}
          renderRow={(row, patch) => (
            <>
              <Field label={say('ประเภทเอกสาร', 'Document type')}>
                <TextInput value={row.key} disabled={disabled} onChange={(v) => patch({ key: v })} mono />
              </Field>
              <Field label={say('อ้างอิงแม่แบบ', 'Template reference')} wide>
                <TextInput value={row.value} disabled={disabled} onChange={(v) => patch({ value: v })} mono />
              </Field>
            </>
          )}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('คำศัพท์ขององค์กร', 'Language pack')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'องค์กรเรียกสิ่งเดียวกันไม่เหมือนกัน — บางที่เรียก BU บางที่เรียกสายธุรกิจ คำที่ใส่ตรงนี้จะไปแทนคำของระบบ',
            'Organisations name the same thing differently — a BU here, a business line there. Words set here replace the product’s own.',
          )}
        </p>
        <ArrayEditor
          items={Object.entries(branding.languagePack).flatMap(([term, byLocale]) =>
            Object.entries(byLocale).map(([loc, text]) => ({ term, locale: loc, text })),
          )}
          disabled={disabled}
          onChange={(rows) => {
            const pack: Record<string, Record<string, string>> = {};
            for (const row of rows) {
              if (row.term === '' || row.locale === '') continue;
              pack[row.term] = { ...(pack[row.term] ?? {}), [row.locale]: row.text };
            }
            set({ languagePack: pack });
          }}
          makeEmpty={() => ({ term: '', locale: 'th', text: '' })}
          addLabel={say('เพิ่มคำ', 'Add term')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ใช้คำมาตรฐานของระบบ', 'Using the product’s own vocabulary')}
          renderRow={(row, patch) => (
            <>
              <Field label={say('คำของระบบ', 'Product term')}>
                <TextInput value={row.term} disabled={disabled} onChange={(v) => patch({ term: v })} mono />
              </Field>
              <Field label={say('ภาษา', 'Locale')}>
                <Select
                  value={row.locale}
                  disabled={disabled}
                  onChange={(v) => patch({ locale: v })}
                  options={[
                    { value: 'th', label: 'th' },
                    { value: 'en', label: 'en' },
                  ]}
                />
              </Field>
              <Field label={say('คำที่องค์กรใช้', 'Replacement')}>
                <TextInput value={row.text} disabled={disabled} onChange={(v) => patch({ text: v })} />
              </Field>
            </>
          )}
        />
      </div>
    </div>
  );
}

/* §4.11 ------------------------------------------------------------------ */

export function GovernanceSection({ profile, update, say, disabled }: SectionProps) {
  const governance = profile.governance;
  const set = (patch: Partial<typeof governance>) => update({ governance: { ...governance, ...patch } });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={say('เก็บ audit ไว้กี่ปี', 'Audit retention (years)')}>
          <NumberInput value={governance.auditRetentionYears} min={1} disabled={disabled} onChange={(v) => set({ auditRetentionYears: v })} />
        </Field>
        <Field label={say('ที่ตั้งของข้อมูล', 'Data residency')}>
          <TextInput value={governance.dataResidency} disabled={disabled} onChange={(v) => set({ dataResidency: v })} />
        </Field>
        <Field
          label={say('นโยบายการส่งออก', 'Export policy')}
          hint={say(
            'ผู้ใช้กลุ่มนี้ทำงานกับสเปรดชีตและจะไม่ไว้ใจระบบที่เอาข้อมูลออกไปตรวจเองไม่ได้',
            'These users work in spreadsheets and will not trust a system whose numbers they cannot take out and check.',
          )}
        >
          <Select
            value={governance.exportPolicy}
            disabled={disabled}
            onChange={(v) => set({ exportPolicy: v })}
            options={[
              { value: 'allow' as const, label: say('อนุญาต', 'Allow') },
              { value: 'watermark' as const, label: say('ใส่ลายน้ำ', 'Watermark') },
              { value: 'deny' as const, label: say('ไม่อนุญาต', 'Deny') },
            ]}
          />
        </Field>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('การปกปิดข้อมูลส่วนบุคคล', 'PII masking')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'ข้อมูลบุคคลธรรมดา เช่น กรรมการและผู้ถือหุ้น ต้องมีนโยบายแยกจากข้อมูลนิติบุคคล',
            'Data about natural persons — directors and shareholders — needs a policy of its own, separate from company data.',
          )}
        </p>
        <ArrayEditor
          items={governance.piiMaskingRules}
          disabled={disabled}
          onChange={(piiMaskingRules) => set({ piiMaskingRules })}
          makeEmpty={() => ({ field: '', rule: 'mask' as const })}
          addLabel={say('เพิ่มกฎ', 'Add rule')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ยังไม่มีกฎ', 'No rules yet')}
          renderRow={(rule, patch) => (
            <>
              <Field label={say('field', 'Field')}>
                <TextInput value={rule.field} disabled={disabled} onChange={(v) => patch({ field: v })} mono />
              </Field>
              <Field label={say('วิธี', 'Rule')}>
                <Select
                  value={rule.rule}
                  disabled={disabled}
                  onChange={(v) => patch({ rule: v })}
                  options={[
                    { value: 'mask' as const, label: say('ปิดบางส่วน', 'Mask') },
                    { value: 'hash' as const, label: say('แฮช', 'Hash') },
                    { value: 'drop' as const, label: say('ไม่เก็บ', 'Drop') },
                  ]}
                />
              </Field>
            </>
          )}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('ระยะเวลาเก็บข้อมูล', 'Retention by entity type')}</h3>
        <ArrayEditor
          items={Object.entries(governance.retentionDaysByEntity).map(([entity, days]) => ({ entity, days }))}
          disabled={disabled}
          onChange={(rows) =>
            set({
              retentionDaysByEntity: Object.fromEntries(
                rows.filter((r) => r.entity !== '' && r.days > 0).map((r) => [r.entity, r.days]),
              ),
            })
          }
          makeEmpty={() => ({ entity: '', days: 365 })}
          addLabel={say('เพิ่มรายการ', 'Add rule')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ยังไม่ได้กำหนด — เก็บไม่มีกำหนด', 'Not configured — kept indefinitely')}
          renderRow={(row, patch) => (
            <>
              <Field label={say('ชนิดข้อมูล', 'Entity')}>
                <TextInput value={row.entity} disabled={disabled} onChange={(v) => patch({ entity: v })} mono />
              </Field>
              <Field label={say('เก็บกี่วัน', 'Days')}>
                <NumberInput value={row.days} min={1} disabled={disabled} onChange={(v) => patch({ days: v })} />
              </Field>
            </>
          )}
        />
      </div>
    </div>
  );
}
