import { describe, expect, it } from 'vitest';
import {
  type Course,
  dayClasses,
  decodeShare,
  encodeShare,
  nowAndNext,
  toIcs,
} from '../features/tools/timetable/domain';
import { imagePdf } from '../features/tools/timetable/exporters/pdf';

const os: Course = {
  id: 'os',
  name: 'Operating Systems',
  code: 'CSE3003',
  teacher: 'Dr. Rao',
  room: 'AB1-204',
  slots: ['B11', 'B12', 'B13'],
  color: '#A1D6E2',
  tentative: false,
};
const cn: Course = {
  ...os,
  id: 'cn',
  name: 'Networks, Labs',
  code: 'CSE3002',
  room: '',
  slots: ['D11'],
  color: '#F5C96B',
};
const plan: Course = { ...os, id: 'p', name: 'Planned', code: '', slots: ['A11'], tentative: true };
let n = 0;
const id = () => `n${++n}`;

describe('now and next', () => {
  // Monday 26 Oct 2026. Slot 2 on Monday is B11, 10:05–11:35.
  it('knows the class on now and the next one', () => {
    const r = nowAndNext([os, cn, plan], new Date(2026, 9, 26, 10, 30));
    expect(r.now).toMatchObject({ slot: 'B11', course: { id: 'os' } });
    expect(r.next).toMatchObject({ slot: 'D11', day: 1 }); // Tuesday morning
    expect(r.nextDay).toBe(1);
  });
  it('ignores planned courses and handles Sunday', () => {
    const sunday = nowAndNext([plan, os], new Date(2026, 10, 1, 9, 0));
    expect(sunday.now).toBeNull();
    expect(sunday.next).toMatchObject({ slot: 'B11', day: 0 });
  });
  it('lists a day in period order, planned only where free', () => {
    expect(dayClasses([os, plan], 0).map((c) => c.slot)).toEqual(['A11', 'B11']);
  });
});

describe('share links', () => {
  it('round-trips a timetable', () => {
    const back = decodeShare(encodeShare([os, plan]), id)!;
    expect(back.map(({ id: _i, ...c }) => c)).toEqual([os, plan].map(({ id: _i, ...c }) => c));
  });
  it('drops slots that are not on the grid, and rejects junk', () => {
    const tampered = encodeShare([{ ...os, slots: ['B11', 'Z99'] }]);
    expect(decodeShare(tampered, id)![0]!.slots).toEqual(['B11']);
    expect(decodeShare('not-a-timetable', id)).toBeNull();
    expect(decodeShare(encodeShare([{ ...os, slots: ['Q1'] }]), id)).toBeNull();
  });
});

describe('calendar file', () => {
  it('repeats each class weekly with local times, room and escaped text', () => {
    const ics = toIcs([os, cn, plan], new Date(2026, 9, 28), 16);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4); // 3 OS + 1 CN, no planned
    expect(ics).toContain('DTSTART:20261026T100500'); // Monday slot 2
    expect(ics).toContain('RRULE:FREQ=WEEKLY;COUNT=16');
    expect(ics).toContain('LOCATION:AB1-204');
    expect(ics).toContain('SUMMARY:CSE3002 Networks\\, Labs');
  });
});

describe('the PDF', () => {
  it('is a valid one-page PDF whose cross-references point at its objects', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const pdf = imagePdf(jpeg, 2000, 1200);
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    // Byte offsets: compare on the raw bytes, not the decoded string.
    offsets.forEach((o, i) =>
      expect(new TextDecoder().decode(pdf.subarray(o, o + 8))).toBe(`${i + 1} 0 obj\n`),
    );
    expect(text).toContain('/MediaBox [0 0 842 595]');
    expect(text).toContain('/Filter /DCTDecode /Length 9');
  });
});
