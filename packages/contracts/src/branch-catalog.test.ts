import { describe, expect, it } from 'vitest';
import { BRANCH_CATALOG } from './branch-catalog.js';
import { WINTER_2026_27_PROGRAMME_COURSES } from './winter-2026-27-curriculum.js';

describe('Winter 2026-27 programme catalogue', () => {
  it('contains every programme code in the supplied course list', () => {
    const codes = BRANCH_CATALOG.map((branch) => branch.id);
    expect(new Set(codes).size).toBe(20);
    for (const code of ['BET', 'MEI', 'MIB', 'MIP', 'MSI']) expect(codes).toContain(code);
  });

  it('matches the supplied course list exactly for every code it names', () => {
    const winterCodes = new Set<string>(Object.values(WINTER_2026_27_PROGRAMME_COURSES).flat());
    for (const branch of BRANCH_CATALOG) {
      const expected =
        WINTER_2026_27_PROGRAMME_COURSES[branch.id as keyof typeof WINTER_2026_27_PROGRAMME_COURSES] ?? [];
      expect(branch.courses.filter((code) => winterCodes.has(code))).toEqual([...expected]);
    }
  });

  it('does not cross-list courses to branches absent from the supplied list', () => {
    const coursesFor = (code: string) => BRANCH_CATALOG.find((branch) => branch.id === code)!.courses;
    expect(coursesFor('BAI')).not.toContain('ENG2005');
    expect(coursesFor('BCE')).not.toContain('CHY1005');
    expect(coursesFor('BME')).not.toContain('CSE1021');
    expect(coursesFor('BET')).toContain('ENG2005');
    expect(coursesFor('BAI')).toContain('CHY1005');
    expect(coursesFor('MIP')).toContain('CHY1005');
  });

  it('maps specialty courses to the programme codes shown in the course list', () => {
    const coursesFor = (code: string) => BRANCH_CATALOG.find((branch) => branch.id === code)!.courses;
    expect(coursesFor('BCY')).toContain('CHY1007');
    expect(coursesFor('BAS')).toContain('ASE2009');
    expect(coursesFor('BBA')).toContain('BMT1002');
    expect(coursesFor('MEI')).toContain('CSD4001');
    expect(coursesFor('MIP')).toContain('CDS4007');
  });
});
