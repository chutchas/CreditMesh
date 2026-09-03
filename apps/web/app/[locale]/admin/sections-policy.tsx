'use client';

import { COMPONENT_CODES } from '@creditmesh/core';
import {
  ArrayEditor,
  CheckboxGroup,
  ColorInput,
  Field,
  ListInput,
  NullableNumberInput,
  NumberInput,
  Select,
  TextInput,
  Toggle,
  WeightsEditor,
} from '../../../components/form';
import type { SectionProps } from './shared';

/* §4.5 ------------------------------------------------------------------- */

const COMPONENT_LABEL: Record<string, [string, string]> = {
  profitability: ['ความสามารถทำกำไร', 'Profitability'],
  liquidity: ['สภาพคล่อง', 'Liquidity'],
  leverage: ['ภาระหนี้', 'Leverage'],
  equity_strength: ['ความแข็งแรงของส่วนทุน', 'Equity strength'],
  filing_currency: ['ความสดของงบการเงิน', 'Filing currency'],
  payment_behavior: ['พฤติกรรมการชำระ', 'Payment behaviour'],
  delinquency: ['ยอดค้างเกินกำหนดปัจจุบัน', 'Current arrears'],
};

export function CreditPolicySection({ profile, update, say, disabled }: SectionProps) {
  const policy = profile.creditPolicy;
  const set = (patch: Partial<typeof policy>) => update({ creditPolicy: { ...policy, ...patch } });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('เกรดความเสี่ยง', 'Risk grades')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'ช่วงคะแนนห้ามซ้อนกัน เพราะคะแนนเดียวจะตกสองเกรด — ระบบจะไม่ให้บันทึกถ้าซ้อน',
            'Score bands must not overlap: one score would resolve to two grades. Saving is blocked if they do.',
          )}
        </p>
        <ArrayEditor
          items={policy.riskGrades}
          disabled={disabled}
          minItems={1}
          onChange={(riskGrades) => set({ riskGrades })}
          makeEmpty={() => ({ code: '', label: '', minScore: 0, maxScore: 0, color: '#5b6b7c' })}
          addLabel={say('เพิ่มเกรด', 'Add grade')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ต้องมีอย่างน้อยหนึ่งเกรด', 'At least one grade is required')}
          renderRow={(grade, patch) => (
            <>
              <Field label={say('รหัสเกรด', 'Code')}>
                <TextInput value={grade.code} disabled={disabled} onChange={(v) => patch({ code: v })} mono />
              </Field>
              <Field label={say('คำอธิบาย', 'Label')}>
                <TextInput value={grade.label} disabled={disabled} onChange={(v) => patch({ label: v })} />
              </Field>
              <Field label={say('สี', 'Colour')}>
                <ColorInput value={grade.color} disabled={disabled} onChange={(v) => patch({ color: v })} />
              </Field>
              <Field label={say('คะแนนต่ำสุด', 'Min score')}>
                <NumberInput value={grade.minScore} step={0.1} disabled={disabled} onChange={(v) => patch({ minScore: v })} />
              </Field>
              <Field label={say('คะแนนสูงสุด', 'Max score')}>
                <NumberInput value={grade.maxScore} step={0.1} disabled={disabled} onChange={(v) => patch({ maxScore: v })} />
              </Field>
              <Field
                label={say('ทบทวนทุกกี่วัน', 'Review every (days)')}
                hint={say('ใช้กำหนดรอบทบทวนของเกรดนี้', 'Review cadence for this grade')}
              >
                <NumberInput
                  value={policy.reviewFrequencyByGrade[grade.code] ?? 365}
                  min={1}
                  disabled={disabled}
                  onChange={(v) =>
                    set({ reviewFrequencyByGrade: { ...policy.reviewFrequencyByGrade, [grade.code]: v } })
                  }
                />
              </Field>
            </>
          )}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('น้ำหนักการให้คะแนน', 'Scoring weights')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'องค์ประกอบที่ไม่มีข้อมูลจะถูกตัดออกและเกลี่ยน้ำหนักที่เหลือใหม่ — ไม่ให้คะแนนศูนย์ เพราะข้อมูลขาดเป็นปัญหาของข้อมูล ไม่ใช่ข้อค้นพบเรื่องความเสี่ยง',
            'A component with no data is dropped and the remaining weights renormalised, never scored as zero: a gap in our data is a data problem, not a risk finding.',
          )}
        </p>
        <WeightsEditor
          value={policy.scoringWeights}
          keys={[...COMPONENT_CODES]}
          disabled={disabled}
          labelFor={(key) => {
            const pair = COMPONENT_LABEL[key];
            return pair ? say(pair[0], pair[1]) : key;
          }}
          onChange={(scoringWeights) => set({ scoringWeights })}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('ช่วงอายุหนี้และการนับวันเกินกำหนด', 'Ageing & days past due')}</h3>
        <div className="mb-3 max-w-md">
          <Field
            label={say('นับวันเกินกำหนดจาก', 'Count DPD from')}
            hint={say(
              'องค์กรตอบข้อนี้ไม่เหมือนกันจริง ๆ และพอร์ตเดียวกันให้ตัวเลขคนละชุด',
              'Organisations genuinely disagree on this, and the same portfolio gives different numbers under each.',
            )}
          >
            <Select
              value={policy.dpdDefinition}
              disabled={disabled}
              onChange={(v) => set({ dpdDefinition: v })}
              options={[
                { value: 'from_due_date' as const, label: say('วันครบกำหนด', 'Due date') },
                { value: 'from_invoice_date' as const, label: say('วันที่วางบิล', 'Invoice date') },
              ]}
            />
          </Field>
        </div>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'ต้องมีช่วงปลายเปิดพอดีหนึ่งช่วง และช่วงนั้นคือเกณฑ์ "ค้างหนัก" ที่ใช้ติดธงแดง',
            'Exactly one open-ended bucket is required, and that bucket is the "seriously late" threshold used for the arrears flag.',
          )}
        </p>
        <ArrayEditor
          items={policy.agingBuckets}
          disabled={disabled}
          minItems={1}
          onChange={(agingBuckets) => set({ agingBuckets })}
          makeEmpty={() => ({ code: '', label: '', fromDays: 0, toDays: 30 })}
          addLabel={say('เพิ่มช่วง', 'Add bucket')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ต้องมีอย่างน้อยหนึ่งช่วง', 'At least one bucket is required')}
          renderRow={(bucket, patch) => (
            <>
              <Field label={say('รหัส', 'Code')}>
                <TextInput value={bucket.code} disabled={disabled} onChange={(v) => patch({ code: v })} mono />
              </Field>
              <Field label={say('คำอธิบาย', 'Label')}>
                <TextInput value={bucket.label} disabled={disabled} onChange={(v) => patch({ label: v })} />
              </Field>
              <Field label={say('ตั้งแต่ (วัน)', 'From (days)')}>
                <NumberInput value={bucket.fromDays} disabled={disabled} onChange={(v) => patch({ fromDays: v })} />
              </Field>
              <Field label={say('ถึง (วัน)', 'To (days)')}>
                <NullableNumberInput
                  value={bucket.toDays}
                  disabled={disabled}
                  onChange={(v) => patch({ toDays: v })}
                  nullLabel={say('ปลายเปิด', 'open ended')}
                />
              </Field>
            </>
          )}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('สายอนุมัติวงเงิน', 'Limit approval matrix')}</h3>
        <ArrayEditor
          items={policy.limitApprovalMatrix}
          disabled={disabled}
          onChange={(limitApprovalMatrix) => set({ limitApprovalMatrix })}
          makeEmpty={() => ({ fromAmount: 0, toAmount: null, approverRole: '' })}
          addLabel={say('เพิ่มช่วงวงเงิน', 'Add band')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ยังไม่ได้กำหนด', 'Not configured')}
          renderRow={(band, patch) => (
            <>
              <Field label={say('ตั้งแต่', 'From amount')}>
                <NumberInput value={band.fromAmount} step={100000} disabled={disabled} onChange={(v) => patch({ fromAmount: v })} />
              </Field>
              <Field label={say('ถึง', 'To amount')}>
                <NullableNumberInput
                  value={band.toAmount}
                  step={100000}
                  disabled={disabled}
                  onChange={(v) => patch({ toAmount: v })}
                  nullLabel={say('ไม่จำกัด', 'no ceiling')}
                />
              </Field>
              <Field label={say('ผู้อนุมัติ', 'Approver role')}>
                <Select
                  value={band.approverRole}
                  disabled={disabled}
                  onChange={(v) => patch({ approverRole: v })}
                  options={[
                    { value: '', label: say('— เลือก —', '— select —') },
                    ...profile.workflow.roles.map((r) => ({ value: r.code, label: `${r.code} · ${r.label}` })),
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

/* §4.6 ------------------------------------------------------------------- */

const COLLATERAL_TYPES = [
  'bank_guarantee',
  'letter_of_credit',
  'cash_deposit',
  'parent_guarantee',
  'performance_bond',
  'insurance',
  'other',
] as const;

const COLLATERAL_TYPE_LABEL: Record<string, [string, string]> = {
  bank_guarantee: ['หนังสือค้ำประกันธนาคาร', 'Bank guarantee'],
  letter_of_credit: ['เลตเตอร์ออฟเครดิต', 'Letter of credit'],
  cash_deposit: ['เงินมัดจำ', 'Cash deposit'],
  parent_guarantee: ['หนังสือค้ำประกันบริษัทแม่', 'Parent guarantee'],
  performance_bond: ['หนังสือค้ำประกันผลงาน', 'Performance bond'],
  insurance: ['ประกันภัย', 'Insurance'],
  other: ['อื่น ๆ', 'Other'],
};

export function CollateralPolicySection({ profile, update, say, disabled }: SectionProps) {
  const policy = profile.collateralPolicy;
  const set = (patch: Partial<typeof policy>) => update({ collateralPolicy: { ...policy, ...patch } });

  return (
    <div className="space-y-5">
      <Field label={say('ประเภทหลักประกันที่ใช้', 'Collateral types in use')} wide>
        <CheckboxGroup
          value={policy.collateralTypes}
          disabled={disabled}
          onChange={(collateralTypes) => set({ collateralTypes })}
          options={COLLATERAL_TYPES.map((t) => ({
            value: t,
            label: say(COLLATERAL_TYPE_LABEL[t]![0], COLLATERAL_TYPE_LABEL[t]![1]),
          }))}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label={say('วิธีจัดสรร', 'Allocation method')}
          hint={say(
            'นี่ไม่ใช่งานโค้ด มันคือการตกลงกติกาว่าใครมีสิทธิ์ก่อน',
            'This is not a technical setting — it is the agreement about who has first claim.',
          )}
        >
          <Select
            value={policy.allocationMethod}
            disabled={disabled}
            onChange={(v) => set({ allocationMethod: v })}
            options={[
              { value: 'manual' as const, label: say('กำหนดเอง', 'Manual') },
              { value: 'pro_rata' as const, label: say('ตามสัดส่วน', 'Pro rata') },
              { value: 'priority_order' as const, label: say('ตามลำดับสิทธิ์', 'Priority order') },
            ]}
          />
        </Field>
        <Field
          label={say('ลำดับสิทธิ์', 'Priority order')}
          hint={say('รหัสนิติบุคคล บรรทัดละหนึ่ง (ใช้เมื่อเลือกตามลำดับสิทธิ์)', 'Entity codes, one per line; used with priority order')}
        >
          <ListInput value={policy.priorityOrder} disabled={disabled} onChange={(v) => set({ priorityOrder: v })} />
        </Field>
        <Field
          label={say('เตือนก่อนหมดอายุ (วัน)', 'Expiry alerts (days before)')}
        >
          <ListInput
            value={policy.expiryAlertDays.map(String)}
            disabled={disabled}
            onChange={(v) => set({ expiryAlertDays: v.map(Number).filter((n) => Number.isFinite(n) && n > 0) })}
          />
        </Field>
        <Field label={say('สายอนุมัติการโยกสิทธิ์', 'Reallocation approvers')} hint={say('บทบาท บรรทัดละหนึ่ง', 'Roles, one per line')}>
          <ListInput value={policy.reallocationApproval} disabled={disabled} onChange={(v) => set({ reallocationApproval: v })} />
        </Field>
        <Field label={say('การจัดสรรเกินมูลค่า', 'Over-allocation')} wide>
          <Toggle
            checked={policy.allowOverAllocation}
            disabled={disabled}
            onChange={(v) => set({ allowOverAllocation: v })}
            label={say('อนุญาตให้จัดสรรเกินมูลค่าหลักประกัน', 'Allow allocating more than the instrument is worth')}
            hint={say(
              'ปกติปิดไว้ เปิดเฉพาะกรณีที่นโยบายองค์กรยอมรับจริง ๆ',
              'Normally off. Turn it on only where the organisation genuinely permits it.',
            )}
          />
        </Field>
      </div>
    </div>
  );
}

/* §4.7 ------------------------------------------------------------------- */

const SIGNALS = ['shareholder', 'director', 'registered_address', 'name_similarity'] as const;

const SIGNAL_LABEL: Record<string, [string, string]> = {
  shareholder: ['ผู้ถือหุ้นร่วม', 'Shared shareholder'],
  director: ['กรรมการร่วม', 'Shared director'],
  registered_address: ['ที่อยู่จดทะเบียนเดียวกัน', 'Same registered address'],
  name_similarity: ['ชื่อคล้ายกัน', 'Name similarity'],
};

export function GroupResolutionSection({ profile, update, say, disabled }: SectionProps) {
  const policy = profile.groupResolution;
  const set = (patch: Partial<typeof policy>) => update({ groupResolution: { ...policy, ...patch } });

  return (
    <div className="space-y-5">
      <Field label={say('สัญญาณที่เปิดใช้', 'Signals enabled')} wide>
        <CheckboxGroup
          value={policy.signalsEnabled}
          disabled={disabled}
          onChange={(signalsEnabled) => set({ signalsEnabled })}
          options={SIGNALS.map((s) => ({ value: s, label: say(SIGNAL_LABEL[s]![0], SIGNAL_LABEL[s]![1]) }))}
        />
      </Field>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('น้ำหนักสัญญาณ', 'Signal weights')}</h3>
        <WeightsEditor
          value={policy.signalWeights}
          keys={[...SIGNALS]}
          disabled={disabled}
          labelFor={(key) => say(SIGNAL_LABEL[key]![0], SIGNAL_LABEL[key]![1])}
          onChange={(signalWeights) => set({ signalWeights })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={say('ระดับความเชื่อมั่นขั้นต่ำ', 'Confidence threshold')}
          hint={say('ต่ำกว่านี้ไม่แสดงเลย', 'Below this, a group is not shown at all')}
        >
          <NumberInput
            value={policy.confidenceThreshold}
            step={0.05}
            min={0}
            max={1}
            disabled={disabled}
            onChange={(v) => set({ confidenceThreshold: v })}
          />
        </Field>
        <Field label={say('การนำผลไปใช้', 'Applying results')}>
          <Toggle
            checked={false}
            disabled
            onChange={() => undefined}
            label={say('ระบบเสนอ คนยืนยันเสมอ', 'The system proposes, a person confirms')}
            hint={say(
              'ล็อกไว้โดยตั้งใจ ผลการจับกลุ่มห้ามนำไปใช้อัตโนมัติ และห้ามใช้ระงับออเดอร์',
              'Locked on purpose. Group results are never applied automatically, and never used to block an order.',
            )}
          />
        </Field>
      </div>

      <p className="text-xs text-[var(--color-muted)]">
        {say(
          'สองรายการข้างล่างคือสิ่งที่ทำให้ระบบใช้ได้จริง ถ้าไม่ใส่จะเจอผลบวกลวงจนคนเลิกเชื่อภายในสัปดาห์แรก — ที่อยู่ซ้ำมักเป็นสำนักงานบัญชีหรืออาคารสำนักงานให้เช่า และกรรมการซ้ำอาจเป็นกรรมการรับจ้างที่พบในหลายร้อยบริษัท',
          'The two lists below are what make this usable. Without them the engine reports accounting firms and nominee directors as conglomerates, and users stop believing it inside a week.',
        )}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={say('ที่อยู่ที่ยกเว้น', 'Excluded addresses')} hint={say('บรรทัดละหนึ่งที่อยู่', 'One address per line')}>
          <ListInput value={policy.excludedAddresses} disabled={disabled} onChange={(v) => set({ excludedAddresses: v })} />
        </Field>
        <Field label={say('บุคคลที่ยกเว้น', 'Excluded persons')} hint={say('บรรทัดละหนึ่งชื่อ', 'One name per line')}>
          <ListInput value={policy.excludedPersons} disabled={disabled} onChange={(v) => set({ excludedPersons: v })} />
        </Field>
      </div>
    </div>
  );
}
