import { CONTRIBUTION_LIMITS } from '@ss/contracts';
import { describe, expect, it } from 'vitest';
import { fileIssues, planUpload, problemsWith } from '../features/contribute/rules';

const limits = { ...CONTRIBUTION_LIMITS, bytesPerFile: 10, bytesPerSubmission: 10 };

describe('contribution upload errors', () => {
  it('names the file that should be removed to meet the combined limit', () => {
    const files = [new File(['1234567'], 'module-1.pdf'), new File(['12345'], 'module-2.pdf')];

    expect(problemsWith(files, limits)).toContain(
      'These files total 12 B; the limit is 10 B. To fit, remove or upload separately: module-1.pdf (7 B).',
    );
  });

  it('names an oversized ZIP and tells the contributor how to split it', () => {
    const files = [new File(['12345678901'], 'DBMS (CSE3001).zip')];

    expect(problemsWith(files, limits)).toContain(
      'DBMS (CSE3001).zip is 11 B; the per-file limit is 10 B. Make smaller ZIPs by unit or module, then upload them separately.',
    );
  });
});

describe('fileIssues and planUpload name the exact file at fault', () => {
  const mb = (n: number) => n * 1024 * 1024;
  const make = (name: string, size: number) => {
    const f = new File(['x'], name);
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };

  it('marks the file that is too big, the wrong type, and the largest ones pushing the total over', () => {
    const files = [make('a.pdf', mb(70)), make('b.exe', mb(1)), make('c.pdf', mb(45)), make('d.pdf', mb(40))];
    const issues = fileIssues(files);
    expect(issues.get(`a.pdf|${mb(70)}`)).toMatch(/Too big/);
    expect(issues.get(`b.exe|${mb(1)}`)).toMatch(/not accepted/);
    expect(issues.get(`c.pdf|${mb(45)}`)).toMatch(/total/);
    expect(issues.has(`d.pdf|${mb(40)}`)).toBe(false);
  });

  it('skips files the server refuses and splits the rest under the request size', () => {
    const plan = planUpload(
      [make('a.pdf', mb(50)), make('b.pdf', mb(30)), make('c.pdf', mb(30)), make('d.zip', 5)],
      {
        extensions: ['pdf'],
        perFile: mb(40),
        perRequest: mb(50),
      },
    );
    expect(plan.skipped.map((s) => s.name)).toEqual(['a.pdf', 'd.zip']);
    expect(plan.batches.map((b) => b.map((f) => f.name))).toEqual([['b.pdf'], ['c.pdf']]);
  });
});
