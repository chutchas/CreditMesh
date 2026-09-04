import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs script, no types
import { thaiDate, num, fieldAfter, readProfile, readPeople, readHistory, tickGeometry, pageKind, KIND } from '../scripts/corpusx-pdf-to-csv.mjs';

/**
 * The CorpusX registry pages are read by position, so these fixtures are
 * positions: a line is where it is on the page, and that is the whole input.
 *
 * The companies and people here are invented. The real pages carry a PDPA
 * notice for a reason — director and shareholder names are personal data, and
 * a git repository is a poor place to keep somebody else's.
 */

interface Line {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
  words: { x0: number; y0: number; x1: number; y1: number; text: string }[];
}

/** A line, with its words laid out left to right the way pdftotext reports them. */
const line = (x0: number, y0: number, text: string, gap = 4): Line => {
  const words: Line['words'] = [];
  let x = x0;
  for (const word of text.split(' ')) {
    const w = word.length * 5;
    words.push({ x0: x, y0, x1: x + w, y1: y0 + 9, text: word });
    x += w + gap;
  }
  return { x0, y0, x1: x - gap, y1: y0 + 9, text, words };
};

describe('CorpusX PDF values', () => {
  it('reads Buddhist-era dates', () => {
    expect(thaiDate('21 กันยายน 2547')).toBe('2004-09-21');
    expect(thaiDate('5 กันยายน 2568')).toBe('2025-09-05');
    // An AD year is left alone rather than shifted the wrong way.
    expect(thaiDate('5 กันยายน 2025')).toBe('2025-09-05');
    expect(thaiDate('no date here')).toBe('');
    expect(thaiDate('21 Septembre 2547')).toBe('');
  });

  it('reads numbers out of formatted cells', () => {
    expect(num('480,000,000')).toBe(480000000);
    expect(num('16.8729%')).toBe(16.8729);
    // A dash is CorpusX's "nothing here", not a zero.
    expect(num('-')).toBe('');
    expect(num('')).toBe('');
  });

  it('names the page from the English title', () => {
    const lines = [line(28, 33, 'บริษัท ทดสอบ จำกัด'), line(498, 32, 'Related Comapany')];
    // CorpusX's own spelling. Correcting it here would mean not recognising
    // the file.
    expect(KIND[pageKind(lines) as string]).toBe('related');
  });
});

describe('CorpusX Business Profile', () => {
  const page = [
    line(28.5, 86, 'ประเภทนิติบุคคล:'),
    line(124, 86, 'บริษัทจำกัด'),
    line(124, 103, '0105547128782'),
    line(28.5, 104, 'เลขทะเบียนนิติบุคคล:'),
    line(124, 121, '0108254709646'),
    line(28.5, 122, 'เลขทะเบียนนิติบุคคล'),
    line(28.5, 132, '(เดิม):'),
    line(124, 150, '21 กันยายน 2547'),
    line(28.5, 151, 'วันที่จดทะเบียน:'),
    line(28.5, 198, 'สถานะกิจการ:'),
    line(124, 198, 'ยังดำเนินกิจการอยู่'),
    line(124, 216, '480,000,000'),
    line(28.5, 216, 'ทุนจดทะเบียนล่าสุด:'),
    line(28.5, 234, 'ที่ตั้ง (กระทรวง):'),
    line(124, 234, '1/2 ถนนสมมติ แขวงสมมติ เขตสมมติ'),
    line(124, 245, 'จังหวัดกรุงเทพมหานคร 10300'),
    line(28.5, 264, 'หมายเลขโทรศัพท์:'),
    line(124, 263, '0-2000-0000'),
    line(28.5, 300, 'ประเภทธุรกิจ'),
    line(124, 300, '(ล่าสุด) 1. การซื้อและการขาย (68101)'),
    line(124, 325, '(2568) 1. การซื้อและการขาย (68101)'),
    line(28.5, 355, 'ลักษณะธุรกิจ'),
  ];

  it('reads each field from the label beside it', () => {
    const profile = readProfile(page);
    expect(profile.taxId).toBe('0105547128782');
    expect(profile.legalStatus).toBe('ยังดำเนินกิจการอยู่');
    expect(profile.registeredCapital).toBe(480000000);
    expect(profile.registrationDate).toBe('2004-09-21');
    expect(profile.industryCode).toBe('68101');
  });

  it('keeps a two-line address whole and stops before the next field', () => {
    const address = readProfile(page).registeredAddress;
    expect(address).toContain('ถนนสมมติ');
    expect(address).toContain('10300');
    // The phone number is the next label down. A window that ran to the end of
    // the page would swallow it.
    expect(address).not.toContain('0-2000-0000');
  });

  it('does not confuse the current registration number with the former one', () => {
    // Both labels start with the same word and their values are 18pt apart.
    expect(readProfile(page).taxId).not.toBe('0108254709646');
  });

  it('says nothing rather than guessing when a label is absent', () => {
    expect(fieldAfter(page, 'ไม่มีป้ายนี้:')).toBe('');
  });
});

describe('CorpusX Director & Shareholder', () => {
  const page = [
    line(28.5, 67, 'รายชื่อกรรมการ'),
    line(45, 102, '1'),
    line(67, 103, 'นาย ก ทดสอบ'),
    line(45, 120, '2'),
    line(67, 121, 'นางสาว ข ทดสอบ'),
    // The nationality summary above the shareholder table uses the same
    // columns. It must not be read as a shareholder.
    line(223, 103, '1'),
    line(244, 104, 'ไทย'),
    line(207, 150, 'รายชื่อผู้ถือหุ้น'),
    line(324, 152, 'วันที่ประชุมผู้ถือหุ้น: 30 เมษายน 2569 ราคาหุ้นละ (บาท): 100.00'),
    line(214, 174, 'ลำดับ'),
    line(223, 198, '1'),
    line(244, 197, 'นาย ก ทดสอบ'),
    line(365, 198, '60,000,000.00'),
    line(461, 198, '600,000 ไทย'),
    line(546, 198, '60.0000%'),
    line(223, 219, '2'),
    line(244, 218, 'บริษัท ทดสอบโฮลดิ้ง จำกัด'),
    line(365, 219, '40,000,000.00'),
    line(461, 219, '400,000 ไทย'),
    line(546, 219, '40.0000%'),
  ];

  it('reads the directors', () => {
    const { directors } = readPeople(page, '0105547128782');
    expect(directors.map((d: { personName: string }) => d.personName)).toEqual(['นาย ก ทดสอบ', 'นางสาว ข ทดสอบ']);
  });

  it('reads the shareholders without the nationality summary above them', () => {
    const { shareholders } = readPeople(page, '0105547128782');
    expect(shareholders).toHaveLength(2);
    expect(shareholders.map((s: { sharePct: number }) => s.sharePct)).toEqual([60, 40]);
  });

  it('tells a company shareholder from a person', () => {
    const { shareholders } = readPeople(page, '0105547128782');
    expect(shareholders[0].holderType).toBe('person');
    expect(shareholders[1].holderType).toBe('company');
  });

  it('splits the share count from the nationality sharing its cell', () => {
    const { shareholders } = readPeople(page, '0105547128782');
    expect(shareholders[0].shareCount).toBe(600000);
    expect(shareholders[0].nationality).toBe('ไทย');
  });

  it('carries the meeting date the register was taken at', () => {
    const { shareholders } = readPeople(page, '0105547128782');
    expect(shareholders[0].asOf).toBe('2026-04-30');
  });
});

describe('CorpusX Historical Changing', () => {
  const page = [
    line(240, 200, 'แรกตั้ง 21 กันยายน 2547'),
    line(480, 200, '5,000,000.00'),
    line(240, 215, 'ปัจจุบัน 16 กรกฎาคม 2568'),
    line(480, 215, '480,000,000.00'),
    line(28, 300, 'แรกตั้ง 21 กันยายน 2547'),
    line(200, 300, 'บริษัท ทดสอบเก่า จำกัด'),
    line(400, 300, 'OLD TEST CO.,LTD.'),
    line(28, 315, 'ปัจจุบัน 5 กันยายน 2568'),
    line(200, 315, 'บริษัท ทดสอบ จำกัด'),
    line(400, 315, 'TEST CO.,LTD.'),
  ];

  it('reads capital changes with their dates', () => {
    const rows = readHistory(page, 'X').filter((r: { kind: string }) => r.kind === 'capital');
    expect(rows.map((r: { changedOn: string; value: number }) => [r.changedOn, r.value])).toEqual([
      ['2004-09-21', 5000000],
      ['2025-07-16', 480000000],
    ]);
  });

  it('reads the name change, which is the one that splits a counterparty in two', () => {
    const rows = readHistory(page, 'X').filter((r: { kind: string }) => r.kind === 'name');
    expect(rows).toHaveLength(2);
    expect(rows[1].value).toContain('TEST CO.,LTD.');
    expect(rows[1].changedOn).toBe('2025-09-05');
  });
});

describe('CorpusX Related Company grid', () => {
  const page = [
    // Column numbers, then the names beneath them. pdftotext runs the last two
    // columns into one line, exactly as it does on the real page.
    line(187, 64, '1'),
    line(240, 64, '2'),
    line(168, 76, 'นางสาว ดา'),
    line(222, 76, 'นาย ปา'),
    line(181, 87, 'รัตน์'),
    line(225, 87, 'ล์ม'),
    line(39, 119, '1'),
    line(55, 114, 'บริษัท หนึ่ง'),
    line(55, 124, '(บจก.)'),
    // A short name puts the row number and the company on ONE line — the shape
    // that used to be skipped, taking its ticks with it.
    line(39, 141, '2 บริษัทสอง (บจก.)'),
  ];

  it('finds a column centre for each numbered person', () => {
    const { columns } = tickGeometry(page);
    expect(columns).toHaveLength(2);
    expect(columns[0].x).toBeCloseTo(189.5, 0);
  });

  it('assembles a header name from words rather than lines', () => {
    const { columns } = tickGeometry(page);
    expect(columns[0].personName).toBe('นางสาวดารัตน์');
    expect(columns[1].personName).toBe('นายปาล์ม');
  });

  it('finds the row whose number shares a line with its company name', () => {
    const { rows } = tickGeometry(page);
    expect(rows).toHaveLength(2);
    expect(rows[1].companyName).toBe('บริษัทสอง (บจก.)');
  });

  it('centres a wrapped company name on both its lines', () => {
    const { rows } = tickGeometry(page);
    // Lines at 114 and 124, so the centre is below the row number's own line.
    expect(rows[0].y).toBeGreaterThan(120);
    expect(rows[0].y).toBeLessThan(130);
  });
});
