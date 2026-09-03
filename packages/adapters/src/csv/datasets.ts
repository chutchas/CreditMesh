import type { CanonicalEntity } from '../contract';

/**
 * Dataset definitions for the CSV / Excel adapter.
 *
 * §5.3 makes this adapter mandatory in every release: it is the one route into
 * the platform that needs no permission from anyone's IT department, and it is
 * the fallback for every other adapter. So the column specs carry generous
 * aliases in both Thai and English — an organisation should be able to upload
 * the export it already has, not build a new one to our column names.
 */

export type FieldType = 'string' | 'number' | 'date' | 'enum';

export interface ColumnSpec {
  canonicalField: string;
  type: FieldType;
  required: boolean;
  /** Lower-cased header spellings that map to this field without configuration. */
  aliases: string[];
  enumValues?: string[];
  description: string;
}

export interface DatasetSpec {
  datasetId: string;
  entity: CanonicalEntity;
  labelTh: string;
  labelEn: string;
  columns: ColumnSpec[];
  /** Rows are unique on these fields; a repeat is an update, not a duplicate. */
  naturalKey: string[];
}

export const DATASETS: DatasetSpec[] = [
  {
    datasetId: 'party',
    entity: 'party',
    labelTh: 'ทะเบียนคู่สัญญา',
    labelEn: 'Counterparty register',
    naturalKey: ['systemId', 'legalEntityCode', 'sourceCode'],
    columns: [
      {
        canonicalField: 'legalEntityCode',
        type: 'string',
        required: true,
        aliases: ['legal_entity', 'legal_entity_code', 'entity', 'entity_code', 'bu', 'company', 'company_code', 'นิติบุคคล', 'รหัสบริษัท'],
        description: 'Code of the legal entity this record belongs to',
      },
      {
        canonicalField: 'sourceCode',
        type: 'string',
        required: true,
        aliases: ['source_code', 'customer_code', 'customer_no', 'supplier_code', 'vendor_code', 'partner_code', 'account', 'รหัสลูกค้า', 'รหัสคู่ค้า'],
        description: 'The party code in the source system',
      },
      {
        canonicalField: 'legalName',
        type: 'string',
        required: true,
        aliases: ['legal_name', 'name', 'customer_name', 'supplier_name', 'party_name', 'ชื่อ', 'ชื่อลูกค้า', 'ชื่อบริษัท'],
        description: 'Registered name',
      },
      {
        canonicalField: 'taxId',
        type: 'string',
        required: false,
        aliases: ['tax_id', 'taxid', 'tax_no', 'vat_no', 'registration_no', 'เลขผู้เสียภาษี', 'เลขประจำตัวผู้เสียภาษี'],
        description: 'Taxpayer identification number',
      },
      {
        canonicalField: 'role',
        type: 'enum',
        required: false,
        enumValues: ['customer', 'supplier', 'prospect'],
        aliases: ['role', 'party_role', 'type', 'ประเภท'],
        description: 'customer | supplier | prospect (defaults to customer)',
      },
    ],
  },
  {
    datasetId: 'ar_item',
    entity: 'ar_open_item',
    labelTh: 'รายการลูกหนี้',
    labelEn: 'Receivable items',
    naturalKey: ['systemId', 'legalEntityCode', 'documentNo'],
    columns: [
      { canonicalField: 'legalEntityCode', type: 'string', required: true, aliases: ['legal_entity', 'legal_entity_code', 'entity', 'company_code', 'นิติบุคคล'], description: 'Legal entity code' },
      { canonicalField: 'partySourceCode', type: 'string', required: true, aliases: ['source_code', 'customer_code', 'customer_no', 'account', 'รหัสลูกค้า'], description: 'Party code in the source system' },
      { canonicalField: 'documentNo', type: 'string', required: true, aliases: ['document_no', 'doc_no', 'invoice_no', 'reference', 'เลขที่เอกสาร', 'เลขที่ใบแจ้งหนี้'], description: 'Document number' },
      { canonicalField: 'documentDate', type: 'date', required: true, aliases: ['document_date', 'doc_date', 'invoice_date', 'posting_date', 'วันที่เอกสาร'], description: 'Document date' },
      { canonicalField: 'dueDate', type: 'date', required: true, aliases: ['due_date', 'net_due_date', 'baseline_date', 'วันครบกำหนด'], description: 'Due date' },
      { canonicalField: 'clearedDate', type: 'date', required: false, aliases: ['cleared_date', 'clearing_date', 'paid_date', 'payment_date', 'วันที่ชำระ'], description: 'Clearing date; blank means still open' },
      { canonicalField: 'amount', type: 'number', required: true, aliases: ['amount', 'amount_doc', 'open_amount', 'balance', 'จำนวนเงิน', 'ยอดค้าง'], description: 'Amount in document currency' },
      { canonicalField: 'currency', type: 'string', required: false, aliases: ['currency', 'curr', 'สกุลเงิน'], description: 'Document currency (defaults to base currency)' },
      { canonicalField: 'amountBase', type: 'number', required: false, aliases: ['amount_base', 'amount_lc', 'local_amount', 'จำนวนเงินสกุลหลัก'], description: 'Amount in base currency; defaults to amount when the currencies match' },
    ],
  },
  {
    datasetId: 'credit_limit',
    entity: 'credit_limit',
    labelTh: 'วงเงินเครดิต',
    labelEn: 'Credit limits',
    naturalKey: ['systemId', 'legalEntityCode', 'partySourceCode'],
    columns: [
      { canonicalField: 'legalEntityCode', type: 'string', required: true, aliases: ['legal_entity', 'entity', 'company_code', 'นิติบุคคล'], description: 'Legal entity code' },
      { canonicalField: 'partySourceCode', type: 'string', required: true, aliases: ['source_code', 'customer_code', 'customer_no', 'รหัสลูกค้า'], description: 'Party code in the source system' },
      { canonicalField: 'limitAmount', type: 'number', required: true, aliases: ['limit', 'limit_amount', 'credit_limit', 'วงเงิน'], description: 'Credit limit amount' },
      { canonicalField: 'currency', type: 'string', required: false, aliases: ['currency', 'curr', 'สกุลเงิน'], description: 'Currency' },
      { canonicalField: 'validFrom', type: 'date', required: false, aliases: ['valid_from', 'from_date', 'วันที่เริ่ม'], description: 'Valid from' },
      { canonicalField: 'validTo', type: 'date', required: false, aliases: ['valid_to', 'to_date', 'วันที่สิ้นสุด'], description: 'Valid to' },
    ],
  },
  {
    datasetId: 'financial_statement',
    entity: 'financial_statement',
    labelTh: 'งบการเงิน',
    labelEn: 'Financial statements',
    naturalKey: ['taxId', 'fiscalYear'],
    columns: [
      { canonicalField: 'taxId', type: 'string', required: true, aliases: ['tax_id', 'taxid', 'registration_no', 'เลขผู้เสียภาษี'], description: 'Taxpayer id of the party' },
      { canonicalField: 'fiscalYear', type: 'number', required: true, aliases: ['fiscal_year', 'year', 'ปี', 'ปีบัญชี'], description: 'Fiscal year' },
      { canonicalField: 'periodEnd', type: 'date', required: false, aliases: ['period_end', 'fy_end', 'วันสิ้นงวด'], description: 'Period end date' },
      { canonicalField: 'currency', type: 'string', required: false, aliases: ['currency', 'สกุลเงิน'], description: 'Currency' },
      { canonicalField: 'revenue', type: 'number', required: false, aliases: ['revenue', 'sales', 'total_revenue', 'รายได้', 'รายได้รวม'], description: 'Revenue' },
      { canonicalField: 'grossProfit', type: 'number', required: false, aliases: ['gross_profit', 'กำไรขั้นต้น'], description: 'Gross profit' },
      { canonicalField: 'netProfit', type: 'number', required: false, aliases: ['net_profit', 'net_income', 'profit', 'กำไรสุทธิ'], description: 'Net profit' },
      { canonicalField: 'totalAssets', type: 'number', required: false, aliases: ['total_assets', 'assets', 'สินทรัพย์รวม'], description: 'Total assets' },
      { canonicalField: 'totalLiabilities', type: 'number', required: false, aliases: ['total_liabilities', 'liabilities', 'หนี้สินรวม'], description: 'Total liabilities' },
      { canonicalField: 'equity', type: 'number', required: false, aliases: ['equity', 'shareholders_equity', 'ส่วนของผู้ถือหุ้น'], description: 'Shareholders equity' },
      { canonicalField: 'currentAssets', type: 'number', required: false, aliases: ['current_assets', 'สินทรัพย์หมุนเวียน'], description: 'Current assets' },
      { canonicalField: 'currentLiabilities', type: 'number', required: false, aliases: ['current_liabilities', 'หนี้สินหมุนเวียน'], description: 'Current liabilities' },
      { canonicalField: 'cash', type: 'number', required: false, aliases: ['cash', 'เงินสด'], description: 'Cash and equivalents' },
      { canonicalField: 'inventory', type: 'number', required: false, aliases: ['inventory', 'สินค้าคงเหลือ'], description: 'Inventory' },
      { canonicalField: 'receivables', type: 'number', required: false, aliases: ['receivables', 'accounts_receivable', 'ลูกหนี้การค้า'], description: 'Trade receivables' },
    ],
  },
];

export function getDataset(datasetId: string): DatasetSpec | undefined {
  return DATASETS.find((d) => d.datasetId === datasetId);
}
