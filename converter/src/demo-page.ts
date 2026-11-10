import sharp from 'sharp';

export interface DemoPageInput {
  courseTitle: string;
  unitTitle: string;
  fileName: string;
  pageNo: number;
  pageCount: number;
}

const NOTES: Record<string, string[]> = {
  Normalisation: [
    'Functional dependency X → Y : X decides Y',
    'Closure X+ : everything X can reach using F',
    '   eg. R(A,B,C,D), F = { A→B, B→C, CD→A }',
    '   {A}+ = { A, B, C }',
    '   {C,D}+ = { C, D, A, B }  ⇒ CD is a candidate key',
    'Partial dep: non-key attr depends on part of a key',
    'Transitive: A → B → C, where B is not a key',
    '3NF test: every X → Y, X superkey or Y prime',
    'BCNF: every determinant is a superkey',
  ],
};

const GENERIC = [
  'Definition first, then one worked example',
  'Key idea: write the given, then what is asked',
  'Step 1 — list what you know',
  'Step 2 — pick the right formula / rule',
  'Step 3 — solve, then check the units',
  'Common mistake: skipping the base case',
  'Exam tip: draw the diagram before you write',
  'Revise: 3 PYQs from this topic',
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Renders a believable "handwritten" notes page as PNG for demo mode. */
export async function renderDemoPage(p: DemoPageInput): Promise<Buffer> {
  const W = 1240;
  const H = 1754;
  const lines = NOTES[p.unitTitle] ?? GENERIC;
  const offset = (p.pageNo - 1) % lines.length;
  const body = Array.from({ length: 22 }, (_, i) => lines[(offset + i) % lines.length]!);
  const rules = Array.from(
    { length: 30 },
    (_, i) =>
      `<line x1="0" x2="${W}" y1="${210 + i * 52}" y2="${210 + i * 52}" stroke="#E3E8F0" stroke-width="2"/>`,
  ).join('');
  const text = body
    .map(
      (l, i) =>
        `<text x="150" y="${300 + i * 52 - 10}" font-family="Comic Sans MS, Segoe Print, cursive, sans-serif" font-size="34" fill="#22306B">${esc(l)}</text>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#FFFFFF"/>
    ${rules}
    <line x1="120" x2="120" y1="0" y2="${H}" stroke="#E39AA6" stroke-width="3"/>
    <text x="150" y="170" font-family="Comic Sans MS, cursive, sans-serif" font-size="56" font-weight="bold" fill="#22306B">${esc(p.unitTitle)}</text>
    <text x="${W - 60}" y="80" text-anchor="end" font-family="monospace" font-size="26" fill="#4D5675">P. ${String(p.pageNo).padStart(2, '0')} / ${p.pageCount}</text>
    <text x="150" y="80" font-family="monospace" font-size="22" fill="#4D5675">${esc(p.courseTitle)} · ${esc(p.fileName)}</text>
    ${text}
    <text x="${W / 2}" y="${H - 50}" text-anchor="middle" font-family="monospace" font-size="22" fill="#9AA3C0">SCHOLARS STACK DEMO PAGE</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
