'use client';

import {
  ArrayEditor,
  CheckboxGroup,
  DateInput,
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

/**
 * §4.12–4.16 — the sections that drive Modules 12 through 17.
 *
 * These shipped as schema before they shipped as a screen, which meant seven
 * engines were reading configuration nobody could change without a deploy. P1
 * says the profile is what makes onboarding a data task rather than a
 * development task, and §9 makes that the release gate; a setting that only a
 * developer can move does not meet it.
 *
 * Two fields on this screen decide money and one decides a score, so each of
 * them carries the reason it exists rather than just its name.
 */

/* §4.12 Collection ------------------------------------------------------- */

const STAGE_LABEL: Record<string, [string, string]> = {
  reminder: ['เตือนก่อนถึงกำหนด', 'Reminder'],
  first_call: ['โทรครั้งแรก', 'First call'],
  formal_notice: ['หนังสือทวงถาม', 'Formal notice'],
  final_notice: ['หนังสือทวงถามครั้งสุดท้าย', 'Final notice'],
  legal_notice: ['หนังสือจากฝ่ายกฎหมาย', 'Legal notice'],
};

const STRATEGY_LABEL: Record<string, [string, string]> = {
  amount: ['ยอดค้าง', 'Amount overdue'],
  daysOverdue: ['จำนวนวันที่เกินกำหนด', 'Days overdue'],
  riskGrade: ['เกรดความเสี่ยง', 'Risk grade'],
};

export function CollectionPolicySection({ profile, update, say, disabled }: SectionProps) {
  const policy = profile.collectionPolicy;
  const set = (patch: Partial<typeof policy>) => update({ collectionPolicy: { ...policy, ...patch } });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('เกณฑ์จัดลำดับคิว', 'Queue priority')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'ลำดับที่ได้เป็นข้อเสนอ ไม่ใช่คำสั่ง — คนตามหนี้เลื่อนเองได้ และระบบจำว่าเขาเลื่อนเป็นอะไร ถ้าคิวไม่ตรงกับที่เขาคิดว่าควรตามในสัปดาห์แรก เขาจะกลับไปใช้ Excel เอาน้ำหนักที่เขาแก้จริงมาปรับตรงนี้',
            'The resulting order is a suggestion, not an instruction: collectors reorder it and the system keeps what they moved it to. If the queue disagrees with them in week one they go back to Excel — so tune these weights from what they actually did.',
          )}
        </p>
        <WeightsEditor
          value={policy.strategyWeights as unknown as Record<string, number>}
          keys={['amount', 'daysOverdue', 'riskGrade']}
          disabled={disabled}
          labelFor={(key) => {
            const pair = STRATEGY_LABEL[key];
            return pair ? say(pair[0], pair[1]) : key;
          }}
          onChange={(weights) =>
            set({
              strategyWeights: {
                amount: weights.amount ?? 0,
                daysOverdue: weights.daysOverdue ?? 0,
                riskGrade: weights.riskGrade ?? 0,
              },
            })
          }
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('ขั้นการติดตามและวันที่เลื่อนขั้น', 'Contact stages')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'ขั้นที่ได้เป็นข้อเสนอเท่านั้น ระบบไม่เลื่อนขั้นให้เอง — ถ้าองค์กรเปิด dunning ใน ERP อยู่ ลูกค้าจะได้หนังสือทวงถามครั้งสุดท้ายจากสองระบบพร้อมกัน',
            'The suggested stage is only ever a suggestion; nothing advances a stage automatically. An organisation already running dunning in its ERP would otherwise send the same customer two final notices from two systems.',
          )}
        </p>
        <div className="mb-3">
          <CheckboxGroup
            value={policy.contactStages}
            options={Object.keys(STAGE_LABEL).map((v) => ({
              value: v as (typeof policy.contactStages)[number],
              label: say(STAGE_LABEL[v]![0], STAGE_LABEL[v]![1]),
            }))}
            disabled={disabled}
            onChange={(contactStages) => set({ contactStages })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {policy.contactStages.map((stage) => (
            <Field key={stage} label={say(STAGE_LABEL[stage]![0], STAGE_LABEL[stage]![1])}>
              <NumberInput
                value={policy.stageTriggerDays[stage] ?? 0}
                min={0}
                disabled={disabled}
                onChange={(v) => set({ stageTriggerDays: { ...policy.stageTriggerDays, [stage]: v } })}
              />
            </Field>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('คำรับปากจะจ่าย (PTP)', 'Promise to pay')}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label={say('รับปากได้ไกลสุดกี่วัน', 'Maximum days ahead')}
            hint={say('เกินนี้ไม่ใช่คำรับปาก แต่คือการเลื่อนปัญหา', 'Beyond this it is not a promise, it is a deferral')}
          >
            <NumberInput value={policy.ptpMaxDays} min={1} disabled={disabled} onChange={(v) => set({ ptpMaxDays: v })} />
          </Field>
          <Field
            label={say('ผิดคำรับปากกี่ครั้งจึงเลื่อนขั้น', 'Broken promises before escalation')}
            hint={say('ตั้งไว้ที่ 1 จะเลื่อนขั้นทุกครั้งจนคนเลิกสนใจ', 'Set to 1 and every slip escalates, until nobody reads escalations')}
          >
            <NumberInput
              value={policy.ptpMaxBrokenBeforeEscalation}
              min={1}
              disabled={disabled}
              onChange={(v) => set({ ptpMaxBrokenBeforeEscalation: v })}
            />
          </Field>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('ข้อโต้แย้งและการพักการตาม', 'Disputes & holds')}</h3>
        <div className="mb-3 max-w-lg">
          <Toggle
            checked={policy.holdWhenDisputeAccepted}
            disabled={disabled}
            onChange={(v) => set({ holdWhenDisputeAccepted: v })}
            label={say('พักการตามเมื่อรับข้อโต้แย้งแล้ว', 'Hold collection on an accepted dispute')}
            hint={say(
              'ข้อโต้แย้งที่องค์กรรับแล้วไม่ใช่หนี้ที่ควรตาม การโทรไปทวงคือการแพ้ข้อโต้แย้งที่แพ้ไปแล้วซ้ำอีกครั้ง',
              'A dispute the organisation has itself accepted is not a debt to chase; calling anyway loses an argument it already lost.',
            )}
          />
        </div>
        <Field label={say('เหตุผลข้อโต้แย้งที่ใช้ในองค์กรนี้', 'Dispute reasons')} wide>
          <ListInput
            value={policy.disputeReasons}
            disabled={disabled}
            placeholder={say('เช่น ของไม่ครบ', 'e.g. short delivery')}
            onChange={(disputeReasons) => set({ disputeReasons })}
          />
        </Field>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('สายการส่งต่อ', 'Escalation matrix')}</h3>
        <ArrayEditor
          items={policy.escalationMatrix}
          disabled={disabled}
          onChange={(escalationMatrix) => set({ escalationMatrix })}
          makeEmpty={() => ({ fromAmount: 0, toAmount: null, role: '' })}
          addLabel={say('เพิ่มขั้น', 'Add step')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ยังไม่ได้กำหนดสายการส่งต่อ', 'No escalation steps configured')}
          renderRow={(row, patch) => (
            <>
              <Field label={say('ตั้งแต่ยอด', 'From amount')}>
                <NumberInput value={row.fromAmount} min={0} disabled={disabled} onChange={(v) => patch({ fromAmount: v })} />
              </Field>
              <Field label={say('ถึงยอด', 'To amount')}>
                <NullableNumberInput
                  value={row.toAmount}
                  disabled={disabled}
                  nullLabel={say('ไม่จำกัด', 'no ceiling')}
                  onChange={(v) => patch({ toAmount: v })}
                />
              </Field>
              <Field label={say('ส่งถึงบทบาท', 'Role')}>
                <TextInput value={row.role} disabled={disabled} onChange={(v) => patch({ role: v })} mono />
              </Field>
            </>
          )}
        />
      </div>

      <Field
        label={say('วันหยุดขององค์กร', 'Working calendar holidays')}
        hint={say('ใช้คำนวณวันทำการของ SLA', 'Used when SLA days are counted in working days')}
        wide
      >
        <ListInput
          value={policy.workingCalendarHolidays}
          disabled={disabled}
          placeholder="2026-12-31"
          onChange={(workingCalendarHolidays) => set({ workingCalendarHolidays })}
        />
      </Field>
    </div>
  );
}

/* §4.13 Late payment charge ---------------------------------------------- */

export function LateChargePolicySection({ profile, update, say, disabled }: SectionProps) {
  const policy = profile.lateChargePolicy;
  const set = (patch: Partial<typeof policy>) => update({ lateChargePolicy: { ...policy, ...patch } });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('อัตราค่าปรับและช่วงเวลาที่มีผล', 'Rates and their effective periods')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'เปลี่ยนอัตราด้วยการเพิ่มแถวใหม่พร้อมวันที่มีผล ไม่ใช่แก้แถวเดิม — การคำนวณย้อนหลังใช้อัตราของวันที่เริ่มล่าช้า ถ้าแก้ทับ ตัวเลขที่เคยเรียกเก็บไปแล้วจะอธิบายไม่ได้ และการกระทบยอดย้อนหลัง 3 เดือนคือเงื่อนไขการรับมอบของโมดูลนี้',
            'Change a rate by adding a row with its own effective date, never by editing the old one. A recomputation uses the rate in force when the lateness began; overwrite it and figures already billed stop reproducing — and reconciling three recomputed months is this module’s acceptance condition.',
          )}
        </p>
        <ArrayEditor
          items={policy.rates}
          disabled={disabled}
          onChange={(rates) => set({ rates })}
          makeEmpty={() => ({
            annualRatePct: 15,
            effectiveFrom: new Date().toISOString().slice(0, 10),
            effectiveTo: null,
            segment: null,
            gradeCode: null,
          })}
          addLabel={say('เพิ่มอัตรา', 'Add rate')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ยังไม่มีอัตรา — โมดูลค่าปรับจะข้ามทุกใบและบอกว่าไม่มีอัตราที่ใช้ได้', 'No rates yet — every item is skipped with "no rate in force"')}
          renderRow={(rate, patch) => (
            <>
              <Field label={say('อัตราต่อปี (%)', 'Annual rate (%)')}>
                <NumberInput
                  value={rate.annualRatePct}
                  step={0.01}
                  min={0}
                  disabled={disabled}
                  onChange={(v) => patch({ annualRatePct: v })}
                />
              </Field>
              <Field label={say('มีผลตั้งแต่', 'Effective from')}>
                <DateInput value={rate.effectiveFrom} disabled={disabled} onChange={(v) => patch({ effectiveFrom: v ?? rate.effectiveFrom })} />
              </Field>
              <Field label={say('มีผลถึง', 'Effective to')}>
                <DateInput
                  value={rate.effectiveTo}
                  nullable
                  nullLabel={say('ยังมีผลอยู่', 'still in force')}
                  disabled={disabled}
                  onChange={(v) => patch({ effectiveTo: v })}
                />
              </Field>
              <Field
                label={say('เฉพาะ segment', 'Segment only')}
                hint={say('เว้นว่างคืออัตรากลาง', 'blank means the house rate')}
              >
                <TextInput
                  value={rate.segment ?? ''}
                  disabled={disabled}
                  onChange={(v) => patch({ segment: v || null })}
                  mono
                />
              </Field>
              <Field
                label={say('เฉพาะเกรด', 'Grade only')}
                hint={say('อัตราที่เจาะจงกว่าชนะอัตรากลางในช่วงเวลาเดียวกัน', 'a more specific rate beats the house rate for the same period')}
              >
                <TextInput
                  value={rate.gradeCode ?? ''}
                  disabled={disabled}
                  onChange={(v) => patch({ gradeCode: v || null })}
                  mono
                />
              </Field>
            </>
          )}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('วิธีคำนวณ', 'How the charge is computed')}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={say('ฐานวันต่อปี', 'Day count')}>
            <Select
              value={policy.dayCountConvention}
              disabled={disabled}
              options={[
                { value: '365' as const, label: '365' },
                { value: '360' as const, label: '360' },
                { value: 'actual' as const, label: say('ตามจริง (นับปีอธิกสุรทิน)', 'actual (leap years counted)') },
              ]}
              onChange={(dayCountConvention) => set({ dayCountConvention })}
            />
          </Field>
          <Field label={say('เริ่มนับจาก', 'Charge starts from')}>
            <Select
              value={policy.chargeStartFrom}
              disabled={disabled}
              options={[
                { value: 'due_date' as const, label: say('วันครบกำหนด', 'Due date') },
                { value: 'invoice_date' as const, label: say('วันที่ใบแจ้งหนี้', 'Invoice date') },
              ]}
              onChange={(chargeStartFrom) => set({ chargeStartFrom })}
            />
          </Field>
          <Field label={say('ผ่อนผัน (วัน)', 'Grace period (days)')}>
            <NumberInput value={policy.gracePeriodDays} min={0} disabled={disabled} onChange={(v) => set({ gracePeriodDays: v })} />
          </Field>
          <Field
            label={say('ต่ำกว่านี้ไม่เรียกเก็บ', 'Minimum charge')}
            hint={say('ค่าปรับ 12 บาทมีต้นทุนในการออกเอกสารสูงกว่าตัวมันเอง', 'a 12-baht charge costs more to raise than it collects')}
          >
            <NumberInput
              value={policy.minimumChargeAmount}
              min={0}
              disabled={disabled}
              onChange={(v) => set({ minimumChargeAmount: v })}
            />
          </Field>
          <Field label={say('การปัดเศษ', 'Rounding')}>
            <Select
              value={policy.roundingRule}
              disabled={disabled}
              options={[
                { value: 'nearest_1' as const, label: say('ปัดเป็นจำนวนเต็ม', 'Nearest 1') },
                { value: 'down_1' as const, label: say('ปัดลงเป็นจำนวนเต็ม', 'Round down to 1') },
                { value: 'nearest_0.01' as const, label: say('ทศนิยม 2 ตำแหน่ง', 'Nearest 0.01') },
                { value: 'none' as const, label: say('ไม่ปัด', 'None') },
              ]}
              onChange={(roundingRule) => set({ roundingRule })}
            />
          </Field>
        </div>
        <div className="mt-3 max-w-lg">
          <Toggle
            checked={policy.compounding}
            disabled={disabled}
            onChange={(v) => set({ compounding: v })}
            label={say('คิดดอกเบี้ยทบต้น', 'Compound the charge')}
            hint={say(
              'ปกติปิดไว้ การทบต้นค่าปรับเป็นคำถามของสัญญา ไม่ใช่ค่าตั้งของระบบ — เปิดเมื่อสัญญาระบุไว้จริงเท่านั้น',
              'Normally off. Compounding a late charge is a contract question, not a system setting — switch it on only where the contract says so.',
            )}
          />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('อำนาจยกเว้น', 'Waiver authority')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'ถ้าไม่ตั้งไว้ = ไม่มีใครยกเว้นได้ ระบบไม่ตีความความว่างเป็นการอนุญาต เพราะรายงานยอดที่ยกเว้นคือสิ่งที่โมดูลนี้มีค่าที่สุด และถ้าใครยกเว้นก็ได้ตั้งแต่เดือนแรก รายงานนั้นก็ไม่มีความหมาย',
            'Unset means nobody may waive: silence is not read as permission. The waived-amount report is what this module is worth having, and it is meaningless if anyone could waive from month one.',
          )}
        </p>
        <ArrayEditor
          items={policy.waiverAuthority}
          disabled={disabled}
          onChange={(waiverAuthority) => set({ waiverAuthority })}
          makeEmpty={() => ({ role: '', maxAmount: null })}
          addLabel={say('เพิ่มผู้มีอำนาจ', 'Add authority')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ยังไม่มีใครยกเว้นค่าปรับได้', 'Nobody is authorised to waive a charge')}
          renderRow={(row, patch) => (
            <>
              <Field label={say('บทบาท', 'Role')}>
                <TextInput value={row.role} disabled={disabled} onChange={(v) => patch({ role: v })} mono />
              </Field>
              <Field label={say('ยกเว้นได้ไม่เกิน', 'Up to')}>
                <NullableNumberInput
                  value={row.maxAmount}
                  disabled={disabled}
                  nullLabel={say('ไม่จำกัด', 'unlimited')}
                  onChange={(v) => patch({ maxAmount: v })}
                />
              </Field>
            </>
          )}
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={say('สายอนุมัติก่อนเรียกเก็บจริง', 'Approval chain before billing')} wide>
            <ListInput
              value={policy.approvalChain}
              disabled={disabled}
              placeholder={say('บทบาทตามลำดับ', 'roles in order')}
              onChange={(approvalChain) => set({ approvalChain })}
            />
          </Field>
          <Field label={say('คู่สัญญาที่ยกเว้นตามข้อตกลง', 'Excluded counterparties')} wide>
            <ListInput
              value={policy.excludedPartyIds}
              disabled={disabled}
              placeholder={say('รหัสคู่สัญญา', 'party id')}
              onChange={(excludedPartyIds) => set({ excludedPartyIds })}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

/* §4.14 Payment & exception ---------------------------------------------- */

const CHANNEL_LABEL: Record<string, [string, string]> = {
  cheque: ['เช็ค', 'Cheque'],
  bill_of_exchange: ['ตั๋วแลกเงิน', 'Bill of exchange'],
  bank_transfer: ['โอนเงิน', 'Bank transfer'],
  bill_payment: ['Bill Payment', 'Bill payment'],
  barcode: ['บาร์โค้ด', 'Barcode'],
  e_payment: ['e-Payment', 'e-Payment'],
  direct_debit: ['หักบัญชีอัตโนมัติ', 'Direct debit'],
  cash: ['เงินสด', 'Cash'],
  other: ['อื่นๆ', 'Other'],
};

const EXCEPTION_LABEL: Record<string, [string, string]> = {
  returned_cheque: ['เช็คคืน', 'Returned cheque'],
  reversal: ['รายการตีกลับ', 'Reversal'],
  mismatch: ['ยอดไม่ตรง', 'Amount mismatch'],
  missing: ['ไม่พบรายการ', 'Missing'],
  failed_transfer: ['โอนไม่สำเร็จ', 'Failed transfer'],
  overpayment: ['ชำระเกิน', 'Overpayment'],
  unidentified_receipt: ['เงินเข้าที่ยังไม่รู้ว่าของใคร', 'Unidentified receipt'],
};

const MATCH_RULE_LABEL: Record<string, [string, string]> = {
  invoice_no: ['เลขที่ใบแจ้งหนี้', 'Invoice number'],
  amount_and_date: ['ยอด + วันครบกำหนด', 'Amount and date'],
  party_and_amount: ['คู่สัญญา + ยอด', 'Counterparty and amount'],
  party_and_reference: ['คู่สัญญา + เลขอ้างอิง', 'Counterparty and reference'],
};

export function PaymentPolicySection({ profile, update, say, disabled }: SectionProps) {
  const policy = profile.paymentPolicy;
  const set = (patch: Partial<typeof policy>) => update({ paymentPolicy: { ...policy, ...patch } });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('ช่องทางรับชำระที่ใช้จริง', 'Payment channels in use')}</h3>
        <CheckboxGroup
          value={policy.channels}
          options={Object.keys(CHANNEL_LABEL).map((v) => ({
            value: v as (typeof policy.channels)[number],
            label: say(CHANNEL_LABEL[v]![0], CHANNEL_LABEL[v]![1]),
          }))}
          disabled={disabled}
          onChange={(channels) => set({ channels })}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('ลำดับกฎการจับคู่', 'Matching rules, in order')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'ลองตามลำดับ กฎแรกที่ชี้ไปที่ใบเดียวชนะ ถ้ากฎไหนเจอหลายใบพร้อมกันจะหยุดทันที ไม่ไล่ไปกฎที่หลวมกว่า — เพราะกฎที่หลวมกว่าแก้ความกำกวมไม่ได้ และเงินที่ตัดผิดใบทำให้ใบที่เหลือดูเหมือนยังไม่จ่ายแล้วถูกส่งเข้าคิวตามหนี้',
            'Tried in order; the first rule that resolves to exactly one open item wins. A rule that finds several stops the payment rather than falling through to a looser one — a looser rule cannot resolve what a stricter one could not, and cash on the wrong invoice makes the others look unpaid and sends them to a collector.',
          )}
        </p>
        <CheckboxGroup
          value={policy.matchingRules}
          options={Object.keys(MATCH_RULE_LABEL).map((v) => ({
            value: v as (typeof policy.matchingRules)[number],
            label: say(MATCH_RULE_LABEL[v]![0], MATCH_RULE_LABEL[v]![1]),
          }))}
          disabled={disabled}
          onChange={(matchingRules) => set({ matchingRules })}
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label={say('ผลต่างยอดที่ยอมรับ', 'Amount tolerance')}>
            <NumberInput value={policy.amountTolerance} min={0} disabled={disabled} onChange={(v) => set({ amountTolerance: v })} />
          </Field>
          <Field label={say('หรือผลต่างเป็น %', 'or tolerance (%)')}>
            <NumberInput
              value={policy.amountTolerancePct}
              step={0.1}
              min={0}
              disabled={disabled}
              onChange={(v) => set({ amountTolerancePct: v })}
            />
          </Field>
          <Field label={say('ผลต่างวันที่ยอมรับ', 'Date tolerance (days)')}>
            <NumberInput
              value={policy.dateToleranceDays}
              min={0}
              disabled={disabled}
              onChange={(v) => set({ dateToleranceDays: v })}
            />
          </Field>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('ประเภทรายการผิดปกติที่ติดตาม', 'Exception types tracked')}</h3>
        <CheckboxGroup
          value={policy.exceptionTypes}
          options={Object.keys(EXCEPTION_LABEL).map((v) => ({
            value: v as (typeof policy.exceptionTypes)[number],
            label: say(EXCEPTION_LABEL[v]![0], EXCEPTION_LABEL[v]![1]),
          }))}
          disabled={disabled}
          onChange={(exceptionTypes) => set({ exceptionTypes })}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('ประเภทไหนเป็นสัญญาณเครดิต', 'Which types are credit signals')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'หัวใจของหัวข้อนี้ตามหลัก P7 — เช็คคืนที่จบลงในรายงานบัญชีอย่างเดียวคือข้อมูลที่เสียเปล่า ประเภทที่ติ๊กไว้จะวิ่งต่อไปที่คะแนนความเสี่ยง Watchlist และคิวตามหนี้ ส่วนชำระเกินเป็นงานบัญชีในองค์กรส่วนใหญ่และเป็นสัญญาณในบางองค์กร ซึ่งไม่มีคำตอบที่ผิด',
            'The heart of this section, and of P7: a returned cheque that ends in a reconciliation report is data thrown away. Types ticked here travel on to the risk index, the watchlist and the collection queue. An overpayment is an accounting chore in most organisations and a warning sign in a few — neither answer is wrong.',
          )}
        </p>
        <CheckboxGroup
          value={policy.creditSignalTypes as (typeof policy.exceptionTypes)[number][]}
          options={Object.keys(EXCEPTION_LABEL).map((v) => ({
            value: v as (typeof policy.exceptionTypes)[number],
            label: say(EXCEPTION_LABEL[v]![0], EXCEPTION_LABEL[v]![1]),
          }))}
          disabled={disabled}
          onChange={(creditSignalTypes) => set({ creditSignalTypes })}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('เกณฑ์เช็คคืนและ SLA', 'Cheque returns & SLA')}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={say('นับย้อนหลังกี่วัน', 'Window (days)')}>
            <NumberInput
              value={policy.chequeReturnWindowDays}
              min={1}
              disabled={disabled}
              onChange={(v) => set({ chequeReturnWindowDays: v })}
            />
          </Field>
          <Field
            label={say('กี่ครั้งจึงเข้า Watchlist', 'Returns before watchlist')}
            hint={say('ตั้งไว้ที่ 1 จะเตือนทุกครั้งจนคนเลิกอ่าน แล้วครั้งที่สองก็ผ่านไปโดยไม่มีใครเห็น', 'Set to 1 and every bounce fires, until people stop reading — and the second one passes unnoticed too')}
          >
            <NumberInput
              value={policy.chequeReturnCountForWatchlist}
              min={1}
              disabled={disabled}
              onChange={(v) => set({ chequeReturnCountForWatchlist: v })}
            />
          </Field>
          <Field label={say('ปิดรายการผิดปกติภายใน (วัน)', 'Resolution SLA (days)')}>
            <NumberInput
              value={policy.resolutionSlaDays}
              min={1}
              disabled={disabled}
              onChange={(v) => set({ resolutionSlaDays: v })}
            />
          </Field>
          <Field
            label={say('ปิดเงินเข้าที่ไม่รู้เจ้าของภายใน (วัน)', 'Unidentified receipt SLA (days)')}
            hint={say('เคสที่เก่าไปเงียบๆ ถ้าไม่มีนาฬิกาจับ', 'the case that goes stale silently without a clock on it')}
          >
            <NumberInput
              value={policy.unidentifiedReceiptSlaDays}
              min={1}
              disabled={disabled}
              onChange={(v) => set({ unidentifiedReceiptSlaDays: v })}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

/* §4.15 Legal & insolvency screening ------------------------------------- */

const SOURCE_LABEL: Record<string, [string, string]> = {
  led: ['กรมบังคับคดี', 'Legal Execution Dept'],
  dbd: ['กรมพัฒนาธุรกิจการค้า', 'DBD'],
  court: ['ศาล', 'Courts'],
  provider_api: ['ผู้ให้บริการข้อมูล', 'Data provider'],
  manual_upload: ['อัปโหลดผลค้นเอง', 'Manual upload'],
};

const EVENT_LABEL: Record<string, [string, string]> = {
  bankruptcy: ['ล้มละลาย', 'Bankruptcy'],
  rehabilitation: ['ฟื้นฟูกิจการ', 'Rehabilitation'],
  legal_execution: ['บังคับคดี', 'Legal execution'],
  litigation: ['คดีความ', 'Litigation'],
  dissolution: ['เลิกกิจการ', 'Dissolution'],
  liquidation: ['ชำระบัญชี', 'Liquidation'],
  status_change: ['เปลี่ยนสถานะนิติบุคคล', 'Status change'],
};

export function LegalScreeningSection({ profile, update, say, disabled }: SectionProps) {
  const policy = profile.legalScreening;
  const set = (patch: Partial<typeof policy>) => update({ legalScreening: { ...policy, ...patch } });
  const grades = profile.creditPolicy.riskGrades;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('แหล่งข้อมูลและขอบเขต', 'Sources & scope')}</h3>
        <CheckboxGroup
          value={policy.sources}
          options={Object.keys(SOURCE_LABEL).map((v) => ({
            value: v as (typeof policy.sources)[number],
            label: say(SOURCE_LABEL[v]![0], SOURCE_LABEL[v]![1]),
          }))}
          disabled={disabled}
          onChange={(sources) => set({ sources })}
        />
        <div className="mt-3 max-w-sm">
          <Field
            label={say('คัดกรองใคร', 'Screen whom')}
            hint={say(
              'การคัดกรองบุคคลธรรมดาอ่อนไหวกว่านิติบุคคลมาก และผลกระทบตกที่ชื่อเสียงของคนโดยตรง',
              'Screening natural persons is far more sensitive than screening companies, and the damage lands on a person’s name.',
            )}
          >
            <Select
              value={policy.scope}
              disabled={disabled}
              options={[
                { value: 'party' as const, label: say('นิติบุคคลเท่านั้น', 'Companies only') },
                { value: 'person' as const, label: say('บุคคลธรรมดาเท่านั้น', 'Natural persons only') },
                { value: 'both' as const, label: say('ทั้งสองแบบ', 'Both') },
              ]}
              onChange={(scope) => set({ scope })}
            />
          </Field>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('รอบการคัดกรองตามเกรด', 'Frequency by grade')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'รายที่ยังไม่เคยคัดกรองถือว่าถึงรอบทันที ไม่ใช่ “อีก 180 วันจากวันที่เราไม่มี”',
            'A counterparty never screened is due now, not "due in 180 days from a date we do not have".',
          )}
        </p>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {grades.map((g) => (
            <Field key={g.code} label={`${g.code} — ${g.label}`}>
              <NumberInput
                value={policy.frequencyDaysByGrade[g.code] ?? policy.defaultFrequencyDays}
                min={1}
                disabled={disabled}
                onChange={(v) => set({ frequencyDaysByGrade: { ...policy.frequencyDaysByGrade, [g.code]: v } })}
              />
            </Field>
          ))}
          <Field label={say('เกรดอื่นหรือไม่มีเกรด', 'Default (no grade)')}>
            <NumberInput
              value={policy.defaultFrequencyDays}
              min={1}
              disabled={disabled}
              onChange={(v) => set({ defaultFrequencyDays: v })}
            />
          </Field>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('การจับคู่ผลค้นและระดับความรุนแรง', 'Matching & severity')}</h3>
        <div className="mb-3 max-w-2xl">
          <Toggle
            checked={policy.requireIdentifierMatch}
            disabled={disabled}
            onChange={(v) => set({ requireIdentifierMatch: v })}
            label={say('ต้องยืนยันด้วยเลขนิติบุคคลหรือเลขทะเบียนเสมอ', 'Require an identifier match, always')}
            hint={say(
              'ปิดข้อนี้แล้วผลค้นจะผูกกับคู่สัญญาด้วยชื่ออย่างเดียวได้ ซึ่งให้ข้อสรุปที่มั่นใจ มีหลักฐานประกอบ และผิดคน — ข้อมูลตัวอย่างมีเคสที่เลขต่างกันหลักเดียวแต่ชื่อเหมือนกันเกือบทั้งหมดไว้ให้ดู ถ้าจะปิดจริงควรรู้ว่ากำลังแลกอะไร',
              'Switch this off and a result can attach to a counterparty on a name alone — a confident, evidenced, wrong conclusion about a named party. The sample data carries a case whose id is one digit off with a nearly identical name; know what you are trading before turning this off.',
            )}
          />
        </div>
        <CheckboxGroup
          value={policy.eventTypes}
          options={Object.keys(EVENT_LABEL).map((v) => ({
            value: v as (typeof policy.eventTypes)[number],
            label: say(EVENT_LABEL[v]![0], EVENT_LABEL[v]![1]),
          }))}
          disabled={disabled}
          onChange={(eventTypes) => set({ eventTypes })}
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {policy.eventTypes.map((code) => (
            <Field key={code} label={say(EVENT_LABEL[code]![0], EVENT_LABEL[code]![1])}>
              <Select
                value={policy.severityMap[code] ?? 'medium'}
                disabled={disabled}
                options={[
                  { value: 'critical' as const, label: say('ร้ายแรง', 'Critical') },
                  { value: 'high' as const, label: say('สูง', 'High') },
                  { value: 'medium' as const, label: say('ปานกลาง', 'Medium') },
                  { value: 'low' as const, label: say('ต่ำ', 'Low') },
                ]}
                onChange={(v) => set({ severityMap: { ...policy.severityMap, [code]: v } })}
              />
            </Field>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('ข้อมูลบุคคลธรรมดา', 'Natural-person data')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={say('เก็บเลขประจำตัวอย่างไร', 'How to store the identifier')}
            hint={say('ไม่เก็บเลขเต็มไม่ว่ากรณีใด — เก็บ 4 ตัวท้ายพอให้แยกคนชื่อซ้ำได้เท่านั้น', 'The whole number is never stored. Last four is enough to tell two people with the same name apart, which is all it is for.')}
          >
            <Select
              value={policy.personIdStorage}
              disabled={disabled}
              options={[
                { value: 'last4' as const, label: say('4 ตัวท้าย', 'Last four digits') },
                { value: 'hash' as const, label: say('ค่าย่อยที่ย้อนกลับไม่ได้', 'Non-reversible handle') },
                { value: 'none' as const, label: say('ไม่เก็บเลย', 'Do not store') },
              ]}
              onChange={(personIdStorage) => set({ personIdStorage })}
            />
          </Field>
          <Field label={say('บทบาทที่เห็นผลค้นบุคคลได้', 'Roles that may see person results')}>
            <ListInput
              value={policy.personEventVisibleToRoles}
              disabled={disabled}
              placeholder="credit_manager"
              onChange={(personEventVisibleToRoles) => set({ personEventVisibleToRoles })}
            />
          </Field>
        </div>
        <div className="mt-3 max-w-2xl">
          <Toggle
            checked={policy.reviewRequired}
            disabled={disabled}
            onChange={(v) => set({ reviewRequired: v })}
            label={say('ต้องมีคนยืนยันก่อนนำผลไปใช้', 'A person confirms before a result is used')}
            hint={say(
              'ระบบเสนอ คนยืนยัน — ผลที่ยังไม่ยืนยันจะไม่ถูกนับเป็นข้อเท็จจริงเกี่ยวกับบริษัทไหนทั้งสิ้น',
              'The platform proposes and a person confirms. An unconfirmed result is never counted as a fact about any company.',
            )}
          />
        </div>
      </div>
    </div>
  );
}

/* §4.16 Risk index ------------------------------------------------------- */

const INDEX_COMPONENT_LABEL: Record<string, [string, string]> = {
  financial: ['ฐานะการเงิน', 'Financial position'],
  payment_behavior: ['พฤติกรรมการชำระ', 'Payment behaviour'],
  delinquency: ['ยอดค้างเกินกำหนด', 'Overdue balance'],
  payment_exception: ['รายการรับชำระผิดปกติ', 'Payment exceptions'],
  collection_outcome: ['ผลการตามหนี้', 'Collection outcome'],
  group_exposure: ['การกระจุกตัวในกลุ่ม', 'Group concentration'],
  collateral_coverage: ['ความคุ้มครองของหลักประกัน', 'Collateral coverage'],
  legal: ['สถานะทางกฎหมาย', 'Legal status'],
  company_change: ['การเปลี่ยนแปลงนิติบุคคล', 'Registry changes'],
};

export function RiskIndexSection({ profile, update, say, disabled }: SectionProps) {
  const policy = profile.riskIndex;
  const set = (patch: Partial<typeof policy>) => update({ riskIndex: { ...policy, ...patch } });
  const enabledCount = policy.components.filter((c) => c.enabled).length;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('องค์ประกอบของคะแนน', 'Score components')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'เปิดทีละองค์ประกอบตามที่โมดูลต้นทางพร้อม ไม่ต้องรอให้ครบเก้าตัว — คะแนนที่คำนวณจากข้อมูลไม่ครบแย่กว่าไม่มีคะแนน และหน้าคะแนนจะติดป้ายบอกเสมอเมื่อองค์ประกอบน้อยกว่าเกณฑ์ขั้นต่ำข้างล่าง',
            'Switch components on one at a time as their source modules land rather than waiting for all nine. A score from incomplete data is worse than no score, and the index screen labels one as incomplete whenever fewer components than the floor below were available.',
          )}
        </p>
        <div className="space-y-2">
          {policy.components.map((component, index) => {
            const patch = (change: Partial<(typeof policy.components)[number]>) => {
              const next = [...policy.components];
              next[index] = { ...component, ...change };
              set({ components: next });
            };
            const pair = INDEX_COMPONENT_LABEL[component.code];
            return (
              <div
                key={component.code}
                className={`rounded-lg border border-[var(--color-line)] p-3 ${component.enabled ? 'bg-[var(--color-canvas)]' : 'bg-transparent opacity-70'}`}
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label={say('องค์ประกอบ', 'Component')}>
                    <div className="pt-1.5 text-sm">{pair ? say(pair[0], pair[1]) : component.code}</div>
                  </Field>
                  <Field label={say('น้ำหนัก', 'Weight')}>
                    <NumberInput
                      value={component.weight}
                      step={0.01}
                      min={0}
                      disabled={disabled || !component.enabled}
                      onChange={(v) => patch({ weight: v })}
                    />
                  </Field>
                  <Field
                    label={say('ถ้าไม่มีข้อมูล', 'When there is no data')}
                    hint={say('เลือกให้ตรงกับความหมายจริงของการไม่มีข้อมูลตัวนั้น', 'Choose what the absence of this particular data actually means')}
                  >
                    <Select
                      value={component.absenceRule}
                      disabled={disabled || !component.enabled}
                      options={[
                        {
                          value: 'no_information' as const,
                          label: say('ไม่รู้ — ตัดออกและติดป้ายว่าไม่ครบ', 'Unknown — drop it, mark the score incomplete'),
                        },
                        {
                          value: 'treat_as_worst' as const,
                          label: say('การไม่มีคือคำตอบ — ให้ต่ำสุด', 'Absence IS the answer — score at worst'),
                        },
                        {
                          value: 'block_score' as const,
                          label: say('ไม่มีข้อมูล = ไม่ให้คะแนนเลย', 'Required — produce no score at all'),
                        },
                      ]}
                      onChange={(absenceRule) => patch({ absenceRule })}
                    />
                  </Field>
                  <Field label={say('เปิดใช้', 'Enabled')}>
                    <Toggle
                      checked={component.enabled}
                      disabled={disabled}
                      onChange={(v) => patch({ enabled: v })}
                      label={component.enabled ? say('เปิด', 'On') : say('ปิด', 'Off')}
                    />
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 rounded border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-xs text-[#b54708]">
          {say(
            'ห้ามเลือก “ตัดออก” กับทุกองค์ประกอบโดยไม่คิด — เคยพลาดมาแล้ว: คู่สัญญาที่ไม่มีประวัติการชำระเลยได้เกรดดี เพราะน้ำหนักของพฤติกรรมการชำระถูกเกลี่ยไปที่งบการเงินเก่า ทั้งที่ยอดทั้งก้อนค้างเกินกำหนดอยู่ ถามทุกครั้งว่า “ไม่มีข้อมูล” แปลว่าไม่รู้ หรือแปลว่าคำตอบ',
            'Do not set every component to "drop it" without thinking. That mistake has been made here: a counterparty with no payment history scored well because the payment weight moved onto an old balance sheet while its entire balance sat past due. For each one, ask whether no data means we do not know, or means the answer.',
          )}
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('การแสดงผลและความเชื่อมั่น', 'Presentation & confidence')}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={say('แสดงเป็น', 'Show as')}>
            <Select
              value={policy.scale}
              disabled={disabled}
              options={[
                { value: 'both' as const, label: say('คะแนนและเกรด', 'Score and grade') },
                { value: 'score' as const, label: say('คะแนนอย่างเดียว', 'Score only') },
                { value: 'grade' as const, label: say('เกรดอย่างเดียว', 'Grade only') },
              ]}
              onChange={(scale) => set({ scale })}
            />
          </Field>
          <Field
            label={say('ต้องมีองค์ประกอบอย่างน้อยกี่ตัว', 'Components needed for confidence')}
            hint={say(
              `ตอนนี้เปิดอยู่ ${enabledCount} ตัว — น้อยกว่านี้คะแนนจะถูกติดป้ายว่าคำนวณจากข้อมูลไม่ครบ`,
              `${enabledCount} components are switched on. Below this figure a score is labelled as built on incomplete data.`,
            )}
          >
            <NumberInput
              value={policy.minComponentsForConfidence}
              min={1}
              disabled={disabled}
              onChange={(v) => set({ minComponentsForConfidence: v })}
            />
          </Field>
          <Field label={say('เก็บประวัติคะแนนกี่วัน', 'Keep score history (days)')}>
            <NumberInput
              value={policy.scoreHistoryRetentionDays}
              min={1}
              disabled={disabled}
              onChange={(v) => set({ scoreHistoryRetentionDays: v })}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field
            label={say('เหตุการณ์ที่ทำให้คำนวณคะแนนใหม่ทันที', 'Events that trigger a recompute')}
            hint={say('เช่น เช็คคืน คดีล้มละลาย การเปลี่ยนวงเงิน', 'e.g. a returned cheque, a bankruptcy, a limit change')}
            wide
          >
            <ListInput
              value={policy.recalcTriggers}
              disabled={disabled}
              placeholder="returned_cheque"
              onChange={(recalcTriggers) => set({ recalcTriggers })}
            />
          </Field>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{say('สิ่งที่แนะนำให้ทำต่อในแต่ละเกรด', 'What each grade should lead to')}</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          {say(
            'คะแนนที่ไม่มีใครทำอะไรต่อคือตัวเลขที่น่าสนใจ ไม่ใช่เครื่องมือ ข้อความที่กรอกตรงนี้จะไปแสดงบนหน้าคะแนนของคู่สัญญาที่ตกเกรดนั้น',
            'A score nobody acts on is an interesting number, not a tool. What you write here appears on the index card of every counterparty that lands on that grade.',
          )}
        </p>
        <ArrayEditor
          items={policy.actionMap}
          disabled={disabled}
          onChange={(actionMap) => set({ actionMap })}
          makeEmpty={() => ({ gradeCode: '', action: '' })}
          addLabel={say('เพิ่มการกระทำ', 'Add action')}
          removeLabel={say('เอาออก', 'Remove')}
          emptyLabel={say('ยังไม่ได้กำหนดว่าเกรดไหนควรทำอะไร', 'No actions defined for any grade')}
          renderRow={(row, patch) => (
            <>
              <Field label={say('เกรด', 'Grade')}>
                <Select
                  value={row.gradeCode}
                  disabled={disabled}
                  options={profile.creditPolicy.riskGrades.map((g) => ({
                    value: g.code,
                    label: `${g.code} — ${g.label}`,
                  }))}
                  onChange={(gradeCode) => patch({ gradeCode })}
                />
              </Field>
              <Field label={say('สิ่งที่ควรทำ', 'Action')} wide>
                <TextInput value={row.action} disabled={disabled} onChange={(v) => patch({ action: v })} />
              </Field>
            </>
          )}
        />
      </div>
    </div>
  );
}
