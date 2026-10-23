import { BRANCH_CATALOG } from '@ss/contracts';
import { cleanTitle, parseUnit, unitKindOf, unitSortOf } from '../application/folders';
import type { Course, CourseFile } from '../domain/entities';
import type { MemoryDb, MemoryObjectStore } from '../infrastructure/memory';

/** Sample catalogue for demo mode and tests. Branch list is a placeholder for the real one. */
export const DEMO_BRANCHES = BRANCH_CATALOG.map((b, sort) => ({
  slug: b.slug,
  name: b.name,
  code: b.id,
  isCommon: false,
  sort,
  shortName: b.shortName,
  tagline: b.tagline,
  description: b.description,
  courseCodes: [...b.courses],
  isActive: true,
}));

type FileSpec = [unitKey: string, unitTitle: string, name: string, pages: number, sizeMb: number];

interface CourseSpec {
  slug: string;
  title: string;
  description: string;
  batchYear: number;
  branch: string;
  semester: number;
  pricePaise: number;
  files: FileSpec[];
}

const DBMS_FILES: FileSpec[] = [
  ['unit-1', 'ER and relational model', 'Unit-1-ER-model-notes.pdf', 22, 2.8],
  ['unit-1', 'ER and relational model', 'Solved-ER-diagrams.pdf', 12, 1.8],
  ['unit-1', 'ER and relational model', 'Relational-model-summary.pdf', 10, 1.2],
  ['unit-2', 'SQL and relational algebra', 'Unit-2-SQL-notes.pdf', 26, 3.4],
  ['unit-2', 'SQL and relational algebra', 'SQL-practice-queries.pdf', 12, 1.5],
  ['unit-3', 'Normalisation', 'Unit-3-Normalisation-notes.pdf', 24, 3.1],
  ['unit-3', 'Normalisation', 'Solved-examples-1NF-to-BCNF.pdf', 14, 1.9],
  ['unit-3', 'Normalisation', 'Class-slides-functional-dependencies.pptx', 8, 4.2],
  ['unit-4', 'Transactions and concurrency', 'Unit-4-Transactions-notes.pdf', 28, 3.6],
  ['unit-4', 'Transactions and concurrency', 'Schedules-and-locking-examples.pdf', 12, 1.6],
  ['unit-5', 'Indexing and hashing', 'Unit-5-Indexing-notes.pdf', 20, 2.6],
  ['unit-5', 'Indexing and hashing', 'B-plus-tree-worked-example.jpg', 10, 3.9],
  ['revision', 'Revision: PYQs and quick sheet', 'Previous-year-questions-solved.pdf', 12, 1.7],
  ['revision', 'Revision: PYQs and quick sheet', 'Two-page-revision-sheet.pdf', 2, 0.4],
];

const short = (title: string, n: number): FileSpec[] => [
  ['unit-1', 'Foundations', `Unit-1-${title}-notes.pdf`, 18 + n, 2.4],
  ['unit-2', 'Core methods', `Unit-2-${title}-notes.pdf`, 20 + n, 2.9],
  ['unit-3', 'Worked problems', `Unit-3-${title}-solved.pdf`, 14 + n, 1.9],
  ['revision', 'Revision', 'Quick-revision-sheet.pdf', 4, 0.6],
];

export const DEMO_COURSES: CourseSpec[] = [
  {
    slug: 'dbms-2025-cse-core',
    title: 'Database Management Systems',
    description:
      'The whole semester in unit order, with solved ER diagrams, SQL practice and a two-page revision sheet for the night before.',
    batchYear: 2025,
    branch: 'bce',
    semester: 3,
    pricePaise: 9900,
    files: DBMS_FILES,
  },
  {
    slug: 'os-2025-cse-core',
    title: 'Operating Systems',
    description: 'Process scheduling to file systems, with every numerical worked out step by step.',
    batchYear: 2025,
    branch: 'bce',
    semester: 4,
    pricePaise: 9900,
    files: short('Operating-Systems', 2),
  },
  {
    slug: 'dsa-2025-cse-core',
    title: 'Data Structures and Algorithms',
    description: 'Trees, graphs and dynamic programming with traced examples.',
    batchYear: 2025,
    branch: 'bce',
    semester: 3,
    pricePaise: 9900,
    files: short('DSA', 4),
  },
  {
    slug: 'maths3-2025-cse-core',
    title: 'Engineering Mathematics III',
    description: 'Transforms and complex variables, one solved problem per concept.',
    batchYear: 2025,
    branch: 'bce',
    semester: 3,
    pricePaise: 7900,
    files: short('Maths-III', 0),
  },
  {
    slug: 'ml-basics-2025-cse-aiml',
    title: 'Foundations of Machine Learning',
    description: 'Regression to SVMs, derivations included.',
    batchYear: 2025,
    branch: 'bai',
    semester: 4,
    pricePaise: 9900,
    files: short('ML', 3),
  },
  {
    slug: 'physics-2026-common',
    title: 'Engineering Physics',
    description: 'First-year physics with every derivation written out.',
    batchYear: 2026,
    branch: 'bai',
    semester: 1,
    pricePaise: 7900,
    files: short('Physics', 1),
  },
  {
    slug: 'calculus-2026-common',
    title: 'Calculus and Differential Equations',
    description: 'Limits to ODEs, with the standard exam questions solved.',
    batchYear: 2026,
    branch: 'bai',
    semester: 1,
    pricePaise: 7900,
    files: short('Calculus', 0),
  },
  {
    slug: 'c-2026-common',
    title: 'Programming in C',
    description: 'Pointers, memory and every lab program explained.',
    batchYear: 2026,
    branch: 'bai',
    semester: 2,
    pricePaise: 9900,
    files: short('C-Programming', 2),
  },
  {
    slug: 'cn-2024-cse-core',
    title: 'Computer Networks',
    description: 'OSI to TCP/IP, subnetting drills and protocol diagrams.',
    batchYear: 2024,
    branch: 'bce',
    semester: 5,
    pricePaise: 9900,
    files: short('Networks', 3),
  },
  {
    slug: 'compiler-2024-cse-core',
    title: 'Compiler Design',
    description: 'Parsing tables built by hand, with every step shown.',
    batchYear: 2024,
    branch: 'bce',
    semester: 6,
    pricePaise: 9900,
    files: short('Compiler', 1),
  },
  {
    slug: 'iot-2023-cse-core',
    title: 'Internet of Things',
    description: 'Sensors to cloud dashboards, with every lab circuit drawn out.',
    batchYear: 2023,
    branch: 'bce',
    semester: 7,
    pricePaise: 9900,
    files: short('IoT', 2),
  },
  {
    slug: 'distributed-2023-cse-core',
    title: 'Distributed Systems',
    description: 'Clocks, consensus and replication, explained with timelines.',
    batchYear: 2023,
    branch: 'bce',
    semester: 7,
    pricePaise: 9900,
    files: short('Distributed', 1),
  },
  {
    slug: 'cloud-2023-cse-core',
    title: 'Cloud Computing',
    description: 'Virtualisation, containers and the AWS services that show up in exams.',
    batchYear: 2023,
    branch: 'bce',
    semester: 7,
    pricePaise: 7900,
    files: short('Cloud', 0),
  },
];

const formatOf = (name: string): CourseFile['format'] => {
  const ext = name.split('.').pop()!.toLowerCase();
  if (ext === 'pptx') return 'pptx';
  if (ext === 'docx') return 'docx';
  if (ext === 'jpg' || ext === 'png') return 'image';
  return 'pdf';
};

export const DEMO_IMPORT_ROOT = 'drive-imports/';

/** "unit-3" + "Normalisation" → the Drive folder name a student would have made. */
function unitFolder(unitKey: string, unitTitle: string): string {
  const m = /^unit-(\d+)$/.exec(unitKey);
  return m ? `Unit ${m[1]} - ${unitTitle}` : cleanTitle(unitTitle.split(':')[0]!);
}

const batchFolder = (year: number) => `${String(year).slice(2)} Batch`;

/**
 * Folders in the demo "R2" that are not courses yet, so the admin import has real-looking
 * Drive exports to choose from: numbered modules, files without unit folders, junk files,
 * an unsupported photo and a nested electives folder.
 */
const IMPORTABLE: [path: string, bytes: number][] = [
  ['23 Batch/Big Data Analytics/Module 1 - Hadoop basics/BDA-M1-notes.pdf', 2_400_000],
  ['23 Batch/Big Data Analytics/Module 2 - MapReduce/BDA-M2-notes.pdf', 2_100_000],
  ['23 Batch/Big Data Analytics/Module 3 - Spark/Spark-class-slides.pptx', 4_800_000],
  ['23 Batch/Big Data Analytics/PYQs/BDA-PYQ-2025-solved.pdf', 900_000],
  ['23 Batch/Information Security/Unit-1 Cryptography/IS_unit1.pdf', 1_900_000],
  ['23 Batch/Information Security/Unit-2 Network attacks/IS_unit2.pdf', 2_300_000],
  ['23 Batch/Information Security/Unit-2 Network attacks/whiteboard.heic', 3_100_000],
  ['23 Batch/Information Security/Unit-3 Firewalls and IDS/IS_unit3.docx', 1_200_000],
  ['23 Batch/software_project_management/SPM full notes.pdf', 5_200_000],
  ['23 Batch/software_project_management/SPM important questions.pdf', 700_000],
  ['23 Batch/software_project_management/Thumbs.db', 20_000],
  ['23 Batch/Sem 7 Electives/Natural Language Processing/Module 1/NLP-M1.pdf', 1_600_000],
  ['23 Batch/Sem 7 Electives/Natural Language Processing/Module 2/NLP-M2.pdf', 1_500_000],
  // Shaped like the real bucket: "Subject (CODE)", reference books and a stray textbook.
  ['23 Batch/Operating Systems (CSE3003)/Module 1/OS-M1-processes.pdf', 1_800_000],
  ['23 Batch/Operating Systems (CSE3003)/PYQs/OS-MTE-2024.pdf', 600_000],
  ['23 Batch/Operating Systems (CSE3003)/Syllabus/CSE3003_syllabus.pdf', 200_000],
  [
    '23 Batch/Operating Systems (CSE3003)/Reference books/Operating System Concepts 9th Edition.pdf',
    9_000_000,
  ],
  ['23 Batch/Operating Systems (CSE3003)/Galvin Operating Systems (z-lib.org).pdf', 8_000_000],
  ['25 Batch/Network Security/Unit 1 - Cryptography basics/notes.pdf', 1_200_000],
  ['25 Batch/Network Security/Unit 2 - Firewalls/notes.pdf', 1_500_000],
];

export function seedDemo(db: MemoryDb, sources?: MemoryObjectStore): void {
  db.batches = [2023, 2024, 2025, 2026].map((year) => ({ year }));
  db.branches = DEMO_BRANCHES.map((b) => ({ ...b }));
  const seqByDrawer = new Map<string, number>();
  const bySlug = new Map<string, Course>();
  for (const spec of DEMO_COURSES) {
    const drawer = `${spec.batchYear}/${spec.branch}`;
    const seq = (seqByDrawer.get(drawer) ?? 0) + 1;
    seqByDrawer.set(drawer, seq);
    const course: Course = {
      id: db.ids.next(),
      slug: spec.slug,
      title: spec.title,
      courseCode: null,
      description: spec.description,
      batchYear: spec.batchYear,
      branchSlug: spec.branch,
      semester: spec.semester,
      seq,
      r2Prefix: `${DEMO_IMPORT_ROOT}${batchFolder(spec.batchYear)}/${spec.title}/`,
      pricePaise: spec.pricePaise,
      status: 'live',
    };
    db.courses.set(course.id, course);
    db.courseBranches.set(
      course.id,
      spec.batchYear === 2026 ? DEMO_BRANCHES.map((branch) => branch.slug) : [course.branchSlug],
    );
    bySlug.set(course.slug, course);
    spec.files.forEach(([key, title, name, pages, sizeMb], i) => {
      const folder = unitFolder(key, title);
      const unit = parseUnit(folder);
      const sourceKey = `${course.r2Prefix}${folder}/${name}`;
      const id = db.ids.next();
      const unitKind = unitKindOf(folder);
      const unitSort = unitSortOf(unitKind, unit.key);
      db.units.set(`${course.id}|${unit.key}`, {
        title: unit.title,
        kind: unitKind,
        sort: unitSort,
        hidden: false,
      });
      const file: CourseFile = {
        id,
        courseId: course.id,
        unitKey: unit.key,
        unitTitle: unit.title,
        unitKind,
        unitSort,
        unitHidden: false,
        hidden: false,
        name,
        format: formatOf(name),
        sizeBytes: Math.round(sizeMb * 1024 * 1024),
        pageCount: pages,
        sourceKey,
        sourceEtag: 'seed',
        conversionStatus: 'ready',
        conversionError: null,
        sort: i,
        previewKey: `pages/${id}/preview.webp`,
      };
      db.files.set(file.id, file);
      sources?.put(sourceKey, new Uint8Array(8), 'application/pdf', 'seed');
    });
  }

  if (sources) {
    for (const [path, bytes] of IMPORTABLE) {
      sources.put(
        `${DEMO_IMPORT_ROOT}${path}`,
        new Uint8Array(Math.min(bytes, 64)),
        'application/octet-stream',
        `v1-${bytes}`,
      );
    }
  }

  const bundle = (
    slug: string,
    title: string,
    description: string,
    batchYear: number,
    rupees: number,
    slugs: string[],
  ) => {
    const id = db.ids.next();
    db.bundles.set(id, {
      id,
      slug,
      title,
      description,
      batchYear,
      pricePaise: rupees * 100,
      status: 'live',
      courseIds: slugs.map((s) => bySlug.get(s)!.id),
    });
  };
  bundle(
    '23-batch-complete-set',
    '23 Batch · complete set',
    'Every 4th-year course on the shelf, in one go, for a lot less than buying them one by one.',
    2023,
    169,
    ['iot-2023-cse-core', 'distributed-2023-cse-core', 'cloud-2023-cse-core'],
  );
  bundle(
    'cse-sem-3-pack',
    'CSE Semester 3 pack',
    'DBMS, DSA and Maths III together: the whole third semester for less than two courses.',
    2025,
    199,
    ['dbms-2025-cse-core', 'dsa-2025-cse-core', 'maths3-2025-cse-core'],
  );

  for (const [i, f] of [
    [
      'cgpa',
      'CGPA calculator',
      'Add your grades and credits, see your CGPA and what you need next semester.',
    ],
    ['timetable', 'Timetable maker', 'Pick your slots and get a clash-free weekly timetable you can save.'],
  ].entries()) {
    db.features.set(f[0]!, { key: f[0]!, title: f[1]!, blurb: f[2]!, status: 'soon', sort: i + 1 });
  }
}
