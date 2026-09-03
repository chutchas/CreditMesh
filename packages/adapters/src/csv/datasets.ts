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
  {
    datasetId: 'registry_profile',
    entity: 'party',
    labelTh: 'ข้อมูลจดทะเบียนนิติบุคคล',
    labelEn: 'Company registry profile',
    naturalKey: ['taxId'],
    columns: [
      { canonicalField: 'taxId', type: 'string', required: true, aliases: ['tax_id', 'taxid', 'registration_no', 'เลขผู้เสียภาษี', 'เลขทะเบียนนิติบุคคล'], description: 'Taxpayer id of the party' },
      { canonicalField: 'legalStatus', type: 'string', required: false, aliases: ['status', 'legal_status', 'สถานะ', 'สถานะนิติบุคคล'], description: 'Registered status, as the registry words it' },
      { canonicalField: 'registeredCapital', type: 'number', required: false, aliases: ['registered_capital', 'capital', 'ทุนจดทะเบียน'], description: 'Registered capital' },
      { canonicalField: 'registrationDate', type: 'date', required: false, aliases: ['registration_date', 'incorporation_date', 'วันจดทะเบียน'], description: 'Date of incorporation' },
      { canonicalField: 'registeredAddress', type: 'string', required: false, aliases: ['registered_address', 'address', 'ที่อยู่', 'ที่อยู่จดทะเบียน'], description: 'Registered address' },
      { canonicalField: 'industryCode', type: 'string', required: false, aliases: ['industry_code', 'tsic', 'ประเภทธุรกิจ', 'รหัสธุรกิจ'], description: 'Industry classification code' },
    ],
  },
  {
    datasetId: 'director',
    entity: 'party',
    labelTh: 'กรรมการ',
    labelEn: 'Directors',
    naturalKey: ['taxId', 'personName'],
    columns: [
      { canonicalField: 'taxId', type: 'string', required: true, aliases: ['tax_id', 'taxid', 'registration_no', 'เลขผู้เสียภาษี'], description: 'Taxpayer id of the company' },
      { canonicalField: 'personName', type: 'string', required: true, aliases: ['name', 'person_name', 'director_name', 'full_name', 'ชื่อ', 'ชื่อกรรมการ'], description: 'Director name' },
      { canonicalField: 'position', type: 'string', required: false, aliases: ['position', 'role', 'title', 'ตำแหน่ง'], description: 'Position as the registry words it' },
      { canonicalField: 'since', type: 'date', required: false, aliases: ['since', 'appointed_date', 'วันที่เริ่ม'], description: 'Appointed on' },
    ],
  },
  {
    datasetId: 'shareholder',
    entity: 'party',
    labelTh: 'ผู้ถือหุ้น',
    labelEn: 'Shareholders',
    naturalKey: ['taxId', 'holderName'],
    columns: [
      { canonicalField: 'taxId', type: 'string', required: true, aliases: ['tax_id', 'taxid', 'company_tax_id', 'เลขผู้เสียภาษี'], description: 'Taxpayer id of the company whose register this is' },
      { canonicalField: 'holderName', type: 'string', required: true, aliases: ['holder_name', 'shareholder', 'shareholder_name', 'name', 'ชื่อผู้ถือหุ้น', 'ผู้ถือหุ้น'], description: 'Shareholder name' },
      { canonicalField: 'holderType', type: 'enum', required: false, enumValues: ['person', 'company'], aliases: ['holder_type', 'type', 'ประเภทผู้ถือหุ้น'], description: 'person | company (defaults to person)' },
      { canonicalField: 'holderTaxId', type: 'string', required: false, aliases: ['holder_tax_id', 'shareholder_tax_id', 'เลขผู้เสียภาษีผู้ถือหุ้น'], description: 'Taxpayer id of a company shareholder' },
      { canonicalField: 'sharePct', type: 'number', required: false, aliases: ['share_pct', 'percent', 'percentage', 'shareholding', 'สัดส่วน', 'ร้อยละ'], description: 'Percentage held' },
    ],
  },
  {
    datasetId: 'supplier_commitment',
    entity: 'purchase_order',
    labelTh: 'ภาระผูกพันกับซัพพลายเออร์',
    labelEn: 'Supplier commitments',
    naturalKey: ['legalEntityCode', 'partySourceCode'],
    columns: [
      { canonicalField: 'legalEntityCode', type: 'string', required: true, aliases: ['legal_entity', 'entity', 'company_code', 'นิติบุคคล'], description: 'Legal entity code' },
      { canonicalField: 'partySourceCode', type: 'string', required: true, aliases: ['source_code', 'supplier_code', 'vendor_code', 'vendor_no', 'รหัสซัพพลายเออร์', 'รหัสผู้ขาย'], description: 'Supplier code in the source system' },
      { canonicalField: 'openCommitment', type: 'number', required: false, aliases: ['open_commitment', 'open_po', 'undelivered_value', 'po_outstanding', 'ยอดสั่งค้างส่ง', 'มูลค่าค้างส่ง'], description: 'Ordered and not yet delivered' },
      { canonicalField: 'annualSpend', type: 'number', required: false, aliases: ['annual_spend', 'spend', 'yearly_spend', 'ยอดซื้อต่อปี'], description: 'Annual spend with this supplier' },
      { canonicalField: 'category', type: 'string', required: false, aliases: ['category', 'material_group', 'commodity', 'หมวด', 'หมวดสินค้า'], description: 'Purchasing category' },
      { canonicalField: 'categoryShare', type: 'number', required: false, aliases: ['category_share', 'share_pct', 'share_of_category', 'สัดส่วนในหมวด'], description: 'This supplier share of the category, 0-100' },
      { canonicalField: 'isSingleSource', type: 'enum', required: false, enumValues: ['true', 'false', 'yes', 'no', 'y', 'n', '1', '0'], aliases: ['single_source', 'is_single_source', 'sole_source', 'แหล่งเดียว'], description: 'No qualified alternative exists today' },
      { canonicalField: 'switchingLeadTimeDays', type: 'number', required: false, aliases: ['switching_lead_time_days', 'lead_time_days', 'qualification_days', 'วันที่ใช้เปลี่ยนเจ้า'], description: 'Working days to qualify an alternative' },
      { canonicalField: 'currency', type: 'string', required: false, aliases: ['currency', 'curr', 'สกุลเงิน'], description: 'Currency' },
    ],
  },
];

export function getDataset(datasetId: string): DatasetSpec | undefined {
  return DATASETS.find((d) => d.datasetId === datasetId);
}
