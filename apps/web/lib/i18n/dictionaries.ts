import type { Locale } from './config';

/**
 * NFR §11 requires both languages in full from day one, including in generated
 * documents, because these groups have executives who do not read Thai. Keeping
 * both in one typed object means a missing translation is a compile error
 * rather than a blank label discovered in a board meeting.
 *
 * Terminology an individual organisation wants changed — what they call a BU,
 * a limit, a counterparty — belongs in the tenant profile's languagePack, not
 * here. This file holds the product's own vocabulary only.
 */
export interface Dictionary {
  common: Record<
    | 'appName' | 'tagline' | 'search' | 'loading' | 'noData' | 'export' | 'save' | 'cancel'
    | 'signIn' | 'signOut' | 'email' | 'password' | 'all' | 'total' | 'evidence' | 'asOf'
    | 'staleWarning' | 'never' | 'party' | 'entity' | 'currency' | 'back',
    string
  >;
  nav: Record<'dashboard' | 'portfolio' | 'simulator' | 'import' | 'admin', string>;
  dashboard: Record<
    'title' | 'subtitle' | 'partiesTracked' | 'totalExposure' | 'overdue' | 'criticalFlags'
    | 'byGrade' | 'dataFreshness' | 'emptyState' | 'emptyStateCta',
    string
  >;
  portfolio: Record<
    'title' | 'subtitle' | 'legalName' | 'taxId' | 'grade' | 'score' | 'exposure' | 'overdue'
    | 'limit' | 'utilization' | 'entities' | 'flags' | 'latestFy' | 'ungraded' | 'runAnalysis'
    | 'filterGrade',
    string
  >;
  flags: Record<
    'no_statement' | 'stale_filing' | 'negative_equity' | 'consecutive_losses'
    | 'liquidity_below_floor' | 'leverage_above_ceiling' | 'revenue_decline_2y',
    string
  >;
  party: Record<
    'financials' | 'ratios' | 'exposureByEntity' | 'identifiers' | 'scoreBreakdown'
    | 'component' | 'rawValue' | 'weight' | 'contribution' | 'missingComponents'
    | 'fiscalYear' | 'revenue' | 'netProfit' | 'equity' | 'currentRatio' | 'debtToEquity'
    | 'netMargin' | 'paymentBehavior' | 'avgDpd' | 'onTime',
    string
  >;
  simulator: Record<
    'title' | 'subtitle' | 'currentRevenue' | 'currentTerms' | 'proposedTerms' | 'grossMargin'
    | 'costOfCapital' | 'expectedUplift' | 'currentBadDebt' | 'proposedBadDebt' | 'days'
    | 'results' | 'netImpact' | 'extraReceivables' | 'carryingCost' | 'badDebtCost'
    | 'grossProfitGain' | 'cashImpact' | 'breakEven' | 'notViable' | 'viable' | 'sensitivity'
    | 'upliftLevel' | 'assumptions',
    string
  >;
  importer: Record<
    'title' | 'subtitle' | 'dataset' | 'chooseFile' | 'preview' | 'rowsRead' | 'rowsAccepted'
    | 'rowsRejected' | 'apply' | 'applied' | 'errors' | 'warnings' | 'row' | 'column' | 'message'
    | 'mappedColumns' | 'unmapped' | 'dataAsOf' | 'history',
    string
  >;
  admin: Record<'title' | 'profileVersion' | 'effectiveFrom' | 'valid' | 'invalid' | 'entities' | 'roles' | 'grades', string>;
}

const th: Dictionary = {
  common: {
    appName: 'CreditMesh',
    tagline: 'ทะเบียนกลางของคู่สัญญาและหลักประกัน',
    search: 'ค้นหา',
    loading: 'กำลังโหลด',
    noData: 'ไม่มีข้อมูล',
    export: 'ส่งออก Excel',
    save: 'บันทึก',
    cancel: 'ยกเลิก',
    signIn: 'เข้าสู่ระบบ',
    signOut: 'ออกจากระบบ',
    email: 'อีเมล',
    password: 'รหัสผ่าน',
    all: 'ทั้งหมด',
    total: 'รวม',
    evidence: 'หลักฐาน',
    asOf: 'ข้อมูล ณ',
    staleWarning: 'ข้อมูลชุดนี้เก่ากว่าเกณฑ์ที่กำหนด',
    never: 'ยังไม่เคยนำเข้า',
    party: 'คู่สัญญา',
    entity: 'นิติบุคคล',
    currency: 'สกุลเงิน',
    back: 'ย้อนกลับ',
  },
  nav: {
    dashboard: 'ภาพรวม',
    portfolio: 'พอร์ตคู่สัญญา',
    simulator: 'จำลองเทอมเครดิต',
    import: 'นำเข้าข้อมูล',
    admin: 'ตั้งค่าองค์กร',
  },
  dashboard: {
    title: 'ภาพรวมพอร์ต',
    subtitle: 'ภาพข้ามนิติบุคคลที่ระบบ ERP ให้ไม่ได้',
    partiesTracked: 'คู่สัญญาในระบบ',
    totalExposure: 'ยอด exposure รวม',
    overdue: 'ยอดค้างเกินกำหนด',
    criticalFlags: 'รายการธงแดง',
    byGrade: 'กระจายตามเกรดความเสี่ยง',
    dataFreshness: 'ความสดของข้อมูล',
    emptyState: 'ยังไม่มีข้อมูลในระบบ',
    emptyStateCta: 'เริ่มจากนำเข้าไฟล์ทะเบียนคู่สัญญา',
  },
  portfolio: {
    title: 'Portfolio X-ray',
    subtitle: 'วินิจฉัยพอร์ตจากงบการเงินและยอดค้างข้ามนิติบุคคล',
    legalName: 'ชื่อนิติบุคคล',
    taxId: 'เลขผู้เสียภาษี',
    grade: 'เกรด',
    score: 'คะแนน',
    exposure: 'Exposure',
    overdue: 'เกินกำหนด',
    limit: 'วงเงินรวม',
    utilization: 'ใช้ไป',
    entities: 'นิติบุคคล',
    flags: 'ธงเตือน',
    latestFy: 'งบล่าสุด',
    ungraded: 'ยังไม่จัดเกรด',
    runAnalysis: 'ประมวลผลใหม่',
    filterGrade: 'กรองตามเกรด',
  },
  flags: {
    no_statement: 'ไม่มีงบการเงินในระบบ',
    stale_filing: 'ไม่ส่งงบการเงินตามเกณฑ์',
    negative_equity: 'ส่วนของผู้ถือหุ้นติดลบ',
    consecutive_losses: 'ขาดทุนต่อเนื่อง',
    liquidity_below_floor: 'สภาพคล่องต่ำกว่าเกณฑ์',
    leverage_above_ceiling: 'หนี้สินต่อทุนสูงกว่าเกณฑ์',
    revenue_decline_2y: 'รายได้ลดลงต่อเนื่อง',
  },
  party: {
    financials: 'งบการเงิน',
    ratios: 'อัตราส่วนทางการเงิน',
    exposureByEntity: 'Exposure แยกตามนิติบุคคล',
    identifiers: 'รหัสในระบบต้นทาง',
    scoreBreakdown: 'ที่มาของคะแนน',
    component: 'องค์ประกอบ',
    rawValue: 'ค่าจริง',
    weight: 'น้ำหนัก',
    contribution: 'ส่วนที่ให้คะแนน',
    missingComponents: 'องค์ประกอบที่ไม่มีข้อมูล',
    fiscalYear: 'ปีบัญชี',
    revenue: 'รายได้',
    netProfit: 'กำไรสุทธิ',
    equity: 'ส่วนของผู้ถือหุ้น',
    currentRatio: 'อัตราส่วนสภาพคล่อง',
    debtToEquity: 'หนี้สินต่อทุน',
    netMargin: 'อัตรากำไรสุทธิ',
    paymentBehavior: 'พฤติกรรมการชำระ',
    avgDpd: 'วันเกินกำหนดเฉลี่ย',
    onTime: 'ชำระตรงเวลา',
  },
  simulator: {
    title: 'จำลองการเปลี่ยนเทอมเครดิต',
    subtitle: 'เปลี่ยนการเถียงด้วยความรู้สึกเป็นการเถียงด้วยตัวเลข',
    currentRevenue: 'ยอดขายต่อปีปัจจุบัน',
    currentTerms: 'เทอมปัจจุบัน',
    proposedTerms: 'เทอมที่เสนอ',
    grossMargin: 'อัตรากำไรขั้นต้น',
    costOfCapital: 'ต้นทุนเงินทุนต่อปี',
    expectedUplift: 'ยอดขายที่คาดว่าจะเพิ่ม',
    currentBadDebt: 'อัตราหนี้สูญปัจจุบัน',
    proposedBadDebt: 'อัตราหนี้สูญที่คาด',
    days: 'วัน',
    results: 'ผลลัพธ์',
    netImpact: 'ผลกระทบสุทธิต่อปี',
    extraReceivables: 'ลูกหนี้ที่เพิ่มขึ้น',
    carryingCost: 'ต้นทุนเงินทุนที่เพิ่มขึ้น',
    badDebtCost: 'ค่าเสียหายที่เพิ่มขึ้น',
    grossProfitGain: 'กำไรขั้นต้นที่เพิ่มขึ้น',
    cashImpact: 'ผลกระทบกระแสเงินสด',
    breakEven: 'ยอดขายที่ต้องเพิ่มเพื่อคุ้มทุน',
    notViable: 'ไม่มีระดับยอดขายใดที่ทำให้คุ้มทุนที่เทอมนี้',
    viable: 'คุ้มทุนที่สมมติฐานนี้',
    sensitivity: 'ความไวต่อยอดขายที่เพิ่ม',
    upliftLevel: 'ยอดขายเพิ่ม',
    assumptions: 'สมมติฐาน',
  },
  importer: {
    title: 'นำเข้าข้อมูล',
    subtitle: 'ทางเข้าที่ไม่ต้องขออนุญาต IT และเป็นแผนสำรองของทุก adapter',
    dataset: 'ชุดข้อมูล',
    chooseFile: 'เลือกไฟล์ CSV',
    preview: 'ตรวจก่อนนำเข้า',
    rowsRead: 'อ่านได้',
    rowsAccepted: 'ผ่าน',
    rowsRejected: 'ไม่ผ่าน',
    apply: 'นำเข้าจริง',
    applied: 'นำเข้าเรียบร้อย',
    errors: 'ข้อผิดพลาด',
    warnings: 'คำเตือน',
    row: 'แถว',
    column: 'คอลัมน์',
    message: 'รายละเอียด',
    mappedColumns: 'คอลัมน์ที่จับคู่ได้',
    unmapped: 'คอลัมน์ที่ไม่ได้ใช้',
    dataAsOf: 'ข้อมูล ณ วันที่',
    history: 'ประวัติการนำเข้า',
  },
  admin: {
    title: 'Tenant Profile',
    profileVersion: 'เวอร์ชัน',
    effectiveFrom: 'มีผลตั้งแต่',
    valid: 'ผ่านการตรวจสอบ',
    invalid: 'พบข้อผิดพลาด',
    entities: 'นิติบุคคล',
    roles: 'บทบาท',
    grades: 'เกรดความเสี่ยง',
  },
};

const en: Dictionary = {
  common: {
    appName: 'CreditMesh',
    tagline: 'Group register of counterparties and collateral',
    search: 'Search',
    loading: 'Loading',
    noData: 'No data',
    export: 'Export to Excel',
    save: 'Save',
    cancel: 'Cancel',
    signIn: 'Sign in',
    signOut: 'Sign out',
    email: 'Email',
    password: 'Password',
    all: 'All',
    total: 'Total',
    evidence: 'Evidence',
    asOf: 'As of',
    staleWarning: 'This dataset is older than its freshness threshold',
    never: 'Never imported',
    party: 'Counterparty',
    entity: 'Legal entity',
    currency: 'Currency',
    back: 'Back',
  },
  nav: {
    dashboard: 'Overview',
    portfolio: 'Portfolio',
    simulator: 'Term simulator',
    import: 'Import',
    admin: 'Tenant profile',
  },
  dashboard: {
    title: 'Portfolio overview',
    subtitle: 'The cross-entity picture the ERP cannot produce',
    partiesTracked: 'Counterparties tracked',
    totalExposure: 'Total exposure',
    overdue: 'Overdue balance',
    criticalFlags: 'Critical flags',
    byGrade: 'Distribution by risk grade',
    dataFreshness: 'Data freshness',
    emptyState: 'Nothing imported yet',
    emptyStateCta: 'Start by importing a counterparty register',
  },
  portfolio: {
    title: 'Portfolio X-ray',
    subtitle: 'Portfolio diagnosis from financial statements and cross-entity balances',
    legalName: 'Legal name',
    taxId: 'Tax ID',
    grade: 'Grade',
    score: 'Score',
    exposure: 'Exposure',
    overdue: 'Overdue',
    limit: 'Total limit',
    utilization: 'Utilisation',
    entities: 'Entities',
    flags: 'Flags',
    latestFy: 'Latest FY',
    ungraded: 'Ungraded',
    runAnalysis: 'Re-run analysis',
    filterGrade: 'Filter by grade',
  },
  flags: {
    no_statement: 'No financial statement on file',
    stale_filing: 'Filing older than threshold',
    negative_equity: 'Negative shareholders equity',
    consecutive_losses: 'Consecutive loss-making years',
    liquidity_below_floor: 'Liquidity below floor',
    leverage_above_ceiling: 'Leverage above ceiling',
    revenue_decline_2y: 'Revenue declining',
  },
  party: {
    financials: 'Financial statements',
    ratios: 'Ratios',
    exposureByEntity: 'Exposure by legal entity',
    identifiers: 'Source system codes',
    scoreBreakdown: 'How the score was built',
    component: 'Component',
    rawValue: 'Raw value',
    weight: 'Weight',
    contribution: 'Contribution',
    missingComponents: 'Components without data',
    fiscalYear: 'Fiscal year',
    revenue: 'Revenue',
    netProfit: 'Net profit',
    equity: 'Equity',
    currentRatio: 'Current ratio',
    debtToEquity: 'Debt / equity',
    netMargin: 'Net margin',
    paymentBehavior: 'Payment behaviour',
    avgDpd: 'Weighted average DPD',
    onTime: 'Paid on time',
  },
  simulator: {
    title: 'Credit term simulator',
    subtitle: 'Turns the terms argument from instinct into arithmetic',
    currentRevenue: 'Current annual revenue',
    currentTerms: 'Current terms',
    proposedTerms: 'Proposed terms',
    grossMargin: 'Gross margin',
    costOfCapital: 'Annual cost of capital',
    expectedUplift: 'Expected revenue uplift',
    currentBadDebt: 'Current bad-debt rate',
    proposedBadDebt: 'Expected bad-debt rate',
    days: 'days',
    results: 'Results',
    netImpact: 'Net annual impact',
    extraReceivables: 'Additional receivables',
    carryingCost: 'Additional carrying cost',
    badDebtCost: 'Additional bad-debt cost',
    grossProfitGain: 'Additional gross profit',
    cashImpact: 'Cash flow impact',
    breakEven: 'Uplift needed to break even',
    notViable: 'No level of uplift breaks even at these terms',
    viable: 'Breaks even at these assumptions',
    sensitivity: 'Sensitivity to uplift',
    upliftLevel: 'Uplift',
    assumptions: 'Assumptions',
  },
  importer: {
    title: 'Import data',
    subtitle: 'The route in that needs nobody else’s permission, and the fallback for every adapter',
    dataset: 'Dataset',
    chooseFile: 'Choose a CSV file',
    preview: 'Validate before importing',
    rowsRead: 'Rows read',
    rowsAccepted: 'Accepted',
    rowsRejected: 'Rejected',
    apply: 'Import',
    applied: 'Imported',
    errors: 'Errors',
    warnings: 'Warnings',
    row: 'Row',
    column: 'Column',
    message: 'Detail',
    mappedColumns: 'Mapped columns',
    unmapped: 'Ignored columns',
    dataAsOf: 'Data as of',
    history: 'Import history',
  },
  admin: {
    title: 'Tenant profile',
    profileVersion: 'Version',
    effectiveFrom: 'Effective from',
    valid: 'Valid',
    invalid: 'Issues found',
    entities: 'Legal entities',
    roles: 'Roles',
    grades: 'Risk grades',
  },
};

const DICTIONARIES: Record<Locale, Dictionary> = { th, en };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
