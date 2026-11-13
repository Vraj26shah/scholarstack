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

/** Slide bullets: shorter lines than notes, made to be read from the back row. */
const SLIDE_POINTS = [
  'What the syllabus asks for in this module',
  'The one definition everything else builds on',
  'Worked example, each step on its own line',
  'The shortcut that saves five minutes in the exam',
  'Where students lose marks — and the fix',
  'Practice: two PYQs, answers next slide',
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

/**
 * Renders a believable page for demo mode, in the shape of its file: a wide lecture slide for a
 * deck, a typed document for a DOC, a handwritten notes page for everything else — so previews
 * show the difference a student is buying.
 */
export async function renderDemoPage(p: DemoPageInput): Promise<Buffer> {
  const ext = extOf(p.fileName);
  if (ext === 'pptx' || ext === 'ppt') return renderSlide(p);
  if (ext === 'docx' || ext === 'doc') return renderDocument(p);
  return renderNotes(p);
}

/** A handwritten notes page, portrait as A4 (PDFs and photos of notes). */
async function renderNotes(p: DemoPageInput): Promise<Buffer> {
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

/** A lecture slide, wide as a screen (16:9), title across the top, few big bullets. */
async function renderSlide(p: DemoPageInput): Promise<Buffer> {
  const W = 1920;
  const H = 1080;
  const offset = (p.pageNo - 1) % SLIDE_POINTS.length;
  const bullets = Array.from({ length: 5 }, (_, i) => SLIDE_POINTS[(offset + i) % SLIDE_POINTS.length]!);
  const list = bullets
    .map(
      (l, i) =>
        `<rect x="150" y="${330 + i * 118 - 26}" width="22" height="22" rx="4" fill="#F5B83D"/>` +
        `<text x="212" y="${330 + i * 118 - 8}" font-family="Segoe UI, Arial, sans-serif" font-size="46" fill="#22306B">${esc(l)}</text>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#FFFFFF"/>
    <rect x="0" y="0" width="${W}" height="14" fill="#2F3C7E"/>
    <rect x="0" y="14" width="${W}" height="6" fill="#1995AD"/>
    <text x="150" y="200" font-family="Segoe UI, Arial, sans-serif" font-size="72" font-weight="700" fill="#2F3C7E">${esc(p.unitTitle)}</text>
    <line x1="150" x2="${W - 150}" y1="248" y2="248" stroke="#E3E8F0" stroke-width="4"/>
    ${list}
    <line x1="150" x2="${W - 150}" y1="${H - 120}" y2="${H - 120}" stroke="#E3E8F0" stroke-width="3"/>
    <text x="150" y="${H - 70}" font-family="monospace" font-size="28" fill="#4D5675">${esc(p.courseTitle)} · ${esc(p.fileName)}</text>
    <text x="${W - 150}" y="${H - 70}" text-anchor="end" font-family="monospace" font-size="28" fill="#4D5675">slide ${p.pageNo} / ${p.pageCount}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** A typed document, portrait as A4: serif type, no handwriting, no ruled paper. */
async function renderDocument(p: DemoPageInput): Promise<Buffer> {
  const W = 1240;
  const H = 1754;
  const lines = NOTES[p.unitTitle] ?? GENERIC;
  const offset = (p.pageNo - 1) % lines.length;
  const body = Array.from({ length: 24 }, (_, i) => lines[(offset + i) % lines.length]!);
  const text = body
    .map(
      (l, i) =>
        `<text x="130" y="${360 + i * 52}" font-family="Georgia, 'Times New Roman', serif" font-size="33" fill="#1F2430">${esc(l)}</text>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#FFFFFF"/>
    <text x="${W / 2}" y="220" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="52" font-weight="bold" fill="#2F3C7E">${esc(p.unitTitle)}</text>
    <line x1="360" x2="${W - 360}" y1="260" y2="260" stroke="#2F3C7E" stroke-width="3"/>
    <text x="${W / 2}" y="305" text-anchor="middle" font-family="Georgia, serif" font-size="26" font-style="italic" fill="#4D5675">${esc(p.courseTitle)} · ${esc(p.fileName)}</text>
    ${text}
    <text x="${W / 2}" y="${H - 90}" text-anchor="middle" font-family="Georgia, serif" font-size="26" fill="#4D5675">Page ${p.pageNo} of ${p.pageCount}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
