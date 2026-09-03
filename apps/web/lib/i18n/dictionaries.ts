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
  nav: Record<'dashboard' | 'portfolio' | 'groups' | 'suppliers' | 'simulator' | 'import' | 'admin', string>;
  suppliers: Record<
    'title' | 'subtitle' | 'supplier' | 'fragility' | 'openCommitment' | 'annualSpend'
    | 'category' | 'share' | 'singleSource' | 'leadTime' | 'disruptionExposure'
    | 'interruption' | 'priority' | 'tracked' | 'singleSourced' | 'atRisk' | 'noData'
    | 'noDataHint' | 'notScored' | 'assumedLeadTime' | 'priorityNote' | 'twoDimensions'
    | 'yes' | 'no' | 'days' | 'coverageGap',
    string
  >;
  groups: Record<
    'title' | 'subtitle' | 'run' | 'running' | 'proposed' | 'confirmed' | 'rejected' | 'members'
    | 'entities' | 'exposure' | 'overdue' | 'limit' | 'confidence' | 'evidence' | 'confirm'
    | 'reject' | 'groupName' | 'noProposals' | 'noProposalsHint' | 'weakestLink' | 'exclusions'
    | 'exclusionsHint' | 'personHub' | 'addressHub' | 'appearsIn' | 'ignoredAlready'
    | 'neverAutomatic' | 'lastRun' | 'edgesFound' | 'belowThreshold' | 'confirmPrompt'
    | 'hubsIgnored' | 'groupsProposed' | 'limitSum' | 'limitSumCaveat' | 'groupUtilisation'
    | 'largestSingleLimit',
    string
  >;
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
    | 'liquidity_below_floor' | 'leverage_above_ceiling' | 'revenue_decline_2y'
    | 'severely_delinquent',
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
    | 'mappedColumns' | 'unmapped' | 'dataAsOf' | 'history' | 'wrongDataset' | 'switchDataset'
    | 'browse' | 'changeFile' | 'dropHint' | 'noFile' | 'hintNeedFile' | 'hintNeedValidate'
    | 'stepFile' | 'stepValidate' | 'stepApply',
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
    groups: 'กลุ่มทุน',
    suppliers: 'ซัพพลายเออร์',
    simulator: 'จำลองเทอมเครดิต',
    import: 'นำเข้าข้อมูล',
    admin: 'ตั้งค่าองค์กร',
  },
  suppliers: {
    title: 'Supplier Financial Watch',
    subtitle: 'ซัพพลายเออร์ที่งบอ่อนแอแต่องค์กรพึ่งพาสูง จัดอันดับตามความเสียหายหากหยุดส่ง',
    supplier: 'ซัพพลายเออร์',
    fragility: 'ความเปราะบางทางการเงิน',
    openCommitment: 'ยอดสั่งค้างส่ง',
    annualSpend: 'ยอดซื้อต่อปี',
    category: 'หมวด',
    share: 'สัดส่วนในหมวด',
    singleSource: 'แหล่งเดียว',
    leadTime: 'วันที่ใช้เปลี่ยนเจ้า',
    disruptionExposure: 'มูลค่าที่เสี่ยงหากหยุดส่ง',
    interruption: 'มูลค่าที่ผลิตไม่ได้ระหว่างหาเจ้าใหม่',
    priority: 'ลำดับที่ควรดู',
    tracked: 'ซัพพลายเออร์ที่ติดตาม',
    singleSourced: 'แหล่งเดียว',
    atRisk: 'แหล่งเดียว + มีธงเตือน',
    noData: 'ยังไม่มีข้อมูลภาระผูกพัน',
    noDataHint: 'นำเข้าชุดข้อมูล "ภาระผูกพันกับซัพพลายเออร์" ก่อน แล้วจึงจะจัดอันดับได้',
    notScored: 'ยังไม่ได้ให้คะแนน',
    assumedLeadTime: 'ใช้ค่าสมมติ',
    priorityNote:
      'ลำดับใช้เพื่อจัดเรียงเท่านั้น ไม่ใช่ค่าความเสียหายที่คาดการณ์ — ความเปราะบางเป็นคะแนน ไม่ใช่ความน่าจะเป็น',
    twoDimensions:
      'สองแกนแยกกันเสมอ: ความเปราะบางคือโอกาสที่เขาจะล้ม ความพึ่งพาคือความเสียหายเมื่อล้ม — แก้คนละวิธี ตัวหนึ่งเฝ้าดู อีกตัวต้องออกแบบให้หายไป',
    yes: 'ใช่',
    no: 'ไม่',
    days: 'วัน',
    coverageGap: 'สัดส่วนที่ไม่มีใครทดแทน',
  },
  groups: {
    title: 'Hidden Group Exposure',
    subtitle: 'คู่สัญญาหลายรายที่เจ้าของเดียวกัน และ exposure รวมระดับกลุ่มข้ามนิติบุคคล',
    run: 'ประมวลผลจับกลุ่มใหม่',
    running: 'กำลังประมวลผล',
    proposed: 'รอการยืนยัน',
    confirmed: 'ยืนยันแล้ว',
    rejected: 'ปฏิเสธแล้ว',
    members: 'สมาชิก',
    entities: 'นิติบุคคล',
    exposure: 'Exposure รวมกลุ่ม',
    overdue: 'เกินกำหนด',
    limit: 'วงเงินรวม',
    confidence: 'ความเชื่อมั่น',
    evidence: 'หลักฐาน',
    confirm: 'ยืนยันว่าเป็นกลุ่มเดียวกัน',
    reject: 'ไม่ใช่กลุ่มเดียวกัน',
    groupName: 'ชื่อกลุ่ม',
    noProposals: 'ยังไม่มีกลุ่มที่ระบบเสนอ',
    noProposalsHint: 'ต้องนำเข้าข้อมูลกรรมการ ผู้ถือหุ้น หรือที่อยู่จดทะเบียนก่อน แล้วจึงกดประมวลผล',
    weakestLink: 'ความเชื่อมั่นของกลุ่มคือเส้นเชื่อมที่อ่อนที่สุด',
    exclusions: 'รายการที่ระบบข้ามให้อัตโนมัติ',
    exclusionsHint:
      'บุคคลหรือที่อยู่ที่ผูกกับคู่สัญญาจำนวนมากเกินเกณฑ์ ระบบข้ามให้แล้วในรอบนี้ — มักเป็นกรรมการรับจ้าง สำนักงานบัญชี หรืออาคารสำนักงานให้เช่า ใส่ไว้ในรายการยกเว้นถาวรได้ที่หน้าตั้งค่าองค์กร',
    personHub: 'บุคคล',
    addressHub: 'ที่อยู่',
    appearsIn: 'ผูกกับคู่สัญญา',
    ignoredAlready: 'ข้ามแล้วในรอบนี้',
    neverAutomatic:
      'ผลจากหน้านี้ห้ามนำไปใช้อัตโนมัติ และห้ามใช้ระงับออเดอร์ — ระบบเสนอ คนยืนยัน',
    lastRun: 'ประมวลผลล่าสุด',
    edgesFound: 'เส้นเชื่อมที่พบ',
    belowThreshold: 'ต่ำกว่าเกณฑ์ ไม่แสดง',
    confirmPrompt: 'ยืนยันว่าคู่สัญญาเหล่านี้เป็นกลุ่มทุนเดียวกัน?',
    hubsIgnored: 'ฮับที่ข้าม',
    groupsProposed: 'กลุ่มที่เสนอ',
    limitSum: 'ผลรวมวงเงินที่อนุมัติแยกราย',
    limitSumCaveat:
      'ไม่มีใครเคยอนุมัติวงเงินก้อนนี้ให้เจ้าของรายเดียว — เป็นผลบวกของวงเงินที่อนุมัติแยกกันคนละครั้ง วงเงินเดี่ยวที่ใหญ่ที่สุดในกลุ่มคือ',
    groupUtilisation: 'ใช้ไปเทียบผลรวม',
    largestSingleLimit: 'วงเงินเดี่ยวสูงสุด',
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
    severely_delinquent: 'ค้างชำระเกินเกณฑ์',
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
    browse: 'เลือกไฟล์จากเครื่อง',
    changeFile: 'เปลี่ยนไฟล์',
    dropHint: 'หรือลากไฟล์ .csv มาวางตรงนี้',
    noFile: 'ยังไม่ได้เลือกไฟล์',
    hintNeedFile: 'เลือกไฟล์ก่อน แล้วปุ่มจะกดได้',
    hintNeedValidate: 'ต้องตรวจให้ผ่านก่อน จึงจะนำเข้าจริงได้',
    wrongDataset: 'หัวคอลัมน์ในไฟล์นี้ตรงกับชุดข้อมูลอื่น',
    switchDataset: 'สลับไปชุดข้อมูลนั้นแล้วตรวจใหม่',
    stepFile: '1 · เลือกไฟล์',
    stepValidate: '2 · ตรวจ',
    stepApply: '3 · นำเข้า',
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
    groups: 'Groups',
    suppliers: 'Suppliers',
    simulator: 'Term simulator',
    import: 'Import',
    admin: 'Tenant profile',
  },
  suppliers: {
    title: 'Supplier financial watch',
    subtitle: 'Suppliers the organisation depends on that cannot afford to fail, ranked by what it costs if they stop',
    supplier: 'Supplier',
    fragility: 'Financial fragility',
    openCommitment: 'Ordered, undelivered',
    annualSpend: 'Annual spend',
    category: 'Category',
    share: 'Share of category',
    singleSource: 'Sole source',
    leadTime: 'Days to switch',
    disruptionExposure: 'At stake if they stop',
    interruption: 'Flow uncovered while switching',
    priority: 'Priority',
    tracked: 'Suppliers tracked',
    singleSourced: 'Sole sourced',
    atRisk: 'Sole sourced and flagged',
    noData: 'No commitment data yet',
    noDataHint: 'Import the “Supplier commitments” dataset first, then this page can rank them',
    notScored: 'Not scored yet',
    assumedLeadTime: 'assumed',
    priorityNote:
      'Priority orders the list; it is not an expected loss. Fragility is a score, not a probability.',
    twoDimensions:
      'Two dimensions, kept apart: fragility is how likely they fail, dependency is what it costs when they do. They have different remedies — one is watched, the other is engineered away.',
    yes: 'Yes',
    no: 'No',
    days: 'days',
    coverageGap: 'Share nothing else covers',
  },
  groups: {
    title: 'Hidden group exposure',
    subtitle: 'Counterparties under common ownership, and what the group owes across every entity',
    run: 'Re-run group resolution',
    running: 'Running',
    proposed: 'Awaiting confirmation',
    confirmed: 'Confirmed',
    rejected: 'Rejected',
    members: 'Members',
    entities: 'Entities',
    exposure: 'Group exposure',
    overdue: 'Overdue',
    limit: 'Total limit',
    confidence: 'Confidence',
    evidence: 'Evidence',
    confirm: 'Confirm as one group',
    reject: 'Not one group',
    groupName: 'Group name',
    noProposals: 'No proposed groups yet',
    noProposalsHint: 'Import directors, shareholders or registered addresses first, then run resolution',
    weakestLink: 'A group is only as confident as the weakest link holding it together',
    exclusions: 'Automatically ignored',
    exclusionsHint:
      'People and addresses linked to more counterparties than the threshold allows were ignored in this run — usually nominee directors, accountancy firms, or serviced offices. Add them to the permanent exclusion list in the tenant profile.',
    personHub: 'Person',
    addressHub: 'Address',
    appearsIn: 'linked to',
    ignoredAlready: 'ignored in this run',
    neverAutomatic:
      'Nothing here is applied automatically, and none of it may be used to block an order. The system proposes; a person confirms.',
    lastRun: 'Last run',
    edgesFound: 'Edges found',
    belowThreshold: 'below threshold, not shown',
    confirmPrompt: 'Confirm that these counterparties are one corporate group?',
    hubsIgnored: 'hubs ignored',
    groupsProposed: 'proposed',
    limitSum: 'Sum of separate limits',
    limitSumCaveat:
      'Nobody approved this as one limit — it is the sum of limits approved separately. The largest single limit in the group is',
    groupUtilisation: 'Used against that sum',
    largestSingleLimit: 'Largest single limit',
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
    severely_delinquent: 'Seriously in arrears',
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
    browse: 'Choose a file',
    changeFile: 'Change file',
    dropHint: 'or drag a .csv file here',
    noFile: 'No file chosen yet',
    hintNeedFile: 'Choose a file to enable these',
    hintNeedValidate: 'Validation has to pass before anything is written',
    wrongDataset: 'The columns in this file match a different dataset',
    switchDataset: 'Switch to it and validate again',
    stepFile: '1 · File',
    stepValidate: '2 · Validate',
    stepApply: '3 · Import',
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
