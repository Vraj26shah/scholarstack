import { zipLayout } from '@ss/contracts';
import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';
import { zip } from './zip-helper';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 10]);

describe('whole-subject ZIP layout', () => {
  it('finds the syllabus, units in order and past papers, inside a subject folder', () => {
    const l = zipLayout([
      'DBMS (CSE3001)/Syllabus/syllabus.pdf',
      'DBMS (CSE3001)/Unit 10 - Recovery/a.pdf',
      'DBMS (CSE3001)/Unit 2 - ER model/b.pdf',
      'DBMS (CSE3001)/Unit 2 - ER model/c.pdf',
      'DBMS (CSE3001)/Module 1 - Intro/d.pdf',
      'DBMS (CSE3001)/PYQs/2024.pdf',
      '__MACOSX/DBMS (CSE3001)/._x',
    ]);
    expect(l.subject).toBe('DBMS (CSE3001)');
    expect(l.units.map((u) => u.name)).toEqual([
      'Module 1 - Intro',
      'Unit 2 - ER model',
      'Unit 10 - Recovery',
    ]);
    expect(l.units[1]!.files).toBe(2);
    expect(l).toMatchObject({ syllabus: 1, pyqs: 1, loose: 0, wholeSubject: true, missing: [] });
  });

  it('says what is missing when it is not a whole subject', () => {
    const l = zipLayout(['notes.pdf', 'Extra/one.pdf']);
    expect(l.wholeSubject).toBe(false);
    expect(l.other).toEqual(['Extra']);
    expect(l.missing.join(' ')).toMatch(/Syllabus.*unit or module.*1 loose file/);
  });

  it('accepts supported files and labels a whole-subject ZIP as one', async () => {
    const { app } = setup();
    const s = new Browser(app);
    await s.signIn('rahul.23bce1@vitbhopal.ac.in');
    const send = async (name: string, bytes: Uint8Array) => {
      const form = new FormData();
      form.set('meta', JSON.stringify({ title: 'OS full notes', kind: 'notes', ownWork: true }));
      form.append('files', new File([bytes as BlobPart], name));
      const res = await app.request('/api/contributions', {
        method: 'POST',
        body: form,
        headers: { authorization: `Bearer ${s.token}`, cookie: s.cookie },
      });
      return { status: res.status, json: (await res.json()) as any };
    };
    // One PDF on its own is fine; a spreadsheet is not.
    expect((await send('notes.pdf', PDF)).status).toBe(201);
    const wrong = await send('marks.xlsx', PDF);
    expect(wrong.status).toBe(400);
    expect(JSON.stringify(wrong.json)).toMatch(/ZIP/);
    // A ZIP with nothing usable inside is refused at once.
    expect((await send('junk.zip', zip([['notes.bin', new TextEncoder().encode('x')]]))).status).toBe(400);
    const ok = await send(
      'OS.zip',
      zip([
        ['OS/Syllabus/syllabus.pdf', PDF],
        ['OS/Unit 1 - Processes/u1.pdf', PDF],
        ['OS/Unit 2 - Memory/u2.pdf', PDF],
      ]),
    );
    expect(ok.status).toBe(201);
    expect(ok.json.files[0].check.label).toMatch(/whole subject, 2 units/);
    expect(ok.json.files[0].check.layout.wholeSubject).toBe(true);
  });
});
