-- ════════════════════════════════════════════════════════════════════════════
-- 0900 · Reference data the site needs to work in production.
-- Idempotent: re-running updates names and adds missing rows, never deletes.
-- Change programmes and curricula here (new migration) or in the table editor.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.programmes (slug, code, name, short_name, tagline, description, sort) values
  ('bai', 'BAI', 'B.Tech Artificial Intelligence', 'B.Tech AI', 'AI, Data Science & Machine Learning',
   'Complete semester study pack for B.Tech AI students at VIT Bhopal.', 0),
  ('bce', 'BCE', 'B.Tech Computer Engineering', 'B.Tech CE', 'Systems, Electronics & Core CS',
   'Complete semester study pack for B.Tech CE students at VIT Bhopal.', 1),
  ('bcg', 'BCG', 'B.Tech CS (Game Development)', 'B.Tech CG', 'Game Development & CS Fundamentals',
   'Complete semester study pack for B.Tech CG students at VIT Bhopal.', 2),
  ('bey', 'BEY', 'B.Tech ECY', 'B.Tech ECY', 'Electronics, Computer Science & Yield',
   'Complete semester study pack for B.Tech ECY students at VIT Bhopal.', 3),
  ('bsa', 'BSA', 'B.Tech Computational Sciences', 'B.Tech SA', 'Data, Cloud & Applied Computing',
   'Complete semester study pack for B.Tech SA students at VIT Bhopal.', 4),
  ('mim', 'MIM', 'M.Tech Integrated Management', 'M.Tech IM', 'Management, CS & Business Analytics',
   'Complete semester study pack for M.Tech IM students at VIT Bhopal.', 5)
on conflict (slug) do update set
  code = excluded.code, name = excluded.name, short_name = excluded.short_name,
  tagline = excluded.tagline, description = excluded.description, sort = excluded.sort;

-- Subjects. Titles come from the folder names in R2 (drive-imports/23 Batch/…);
-- codes without a folder yet keep an empty title until they are imported.
insert into public.subjects (code, title) values
  ('CHY1005', 'Introduction to Computational Chemistry'),
  ('CHY1006', 'Environmental Sustainability'),
  ('CSD1001', 'Principles of Digital Forensics'),
  ('CSD3009', 'Data Structures and Analysis of Algorithms'),
  ('CSE1021', 'Introduction to Problem Solving and Programming'),
  ('CSE2001', 'Object Oriented Programming with C++'),
  ('CSE2003', 'Computer Architecture and Organization'),
  ('CSE2006', 'Programming in Java'),
  ('CSE3001', 'Database Management Systems'),
  ('CSE3003', 'Operating Systems'),
  ('CSE3004', 'Design and Analysis of Algorithms'),
  ('CSE3011', 'Python Programming'),
  ('ECE2002', 'Digital Logic Design'),
  ('ECE2003', 'Signals and Systems'),
  ('EEE1001', 'Electric Circuits and Systems'),
  ('ENG2005', 'Advanced Technical Communication'),
  ('HUM1002', 'Emotional Intelligence'),
  ('MAT1001', 'Calculus and Laplace Transforms'),
  ('MAT2001', 'Differential and Difference Equations'),
  ('MAT2002', 'Discrete Mathematics and Graph Theory'),
  ('MAT3002', 'Applied Linear Algebra'),
  ('MAT3003', 'Probability, Statistics and Reliability'),
  ('MEE2014', 'Engineering Design and Modelling'),
  ('MGT2003', 'Technology Entrepreneurship'),
  ('PHY1003', 'Introduction to Computational Physics'),
  ('SST1003', 'Professional Communication Skills for Engineers'),
  ('CCA2002', ''), ('CDS3005', ''), ('CSA2001', ''), ('CSE2002', ''), ('CSG2006', ''),
  ('ECE3004', ''), ('MAT2003', ''), ('MGT1002', ''), ('PHY1005', '')
on conflict (code) do update set
  title = case when public.subjects.title = '' then excluded.title else public.subjects.title end;

-- Curriculum: which programme studies which subject (pre-selects tabs on import).
insert into public.programme_subjects (programme_slug, subject_code)
select p, s from (values
  ('bai', array['CSE2001','CSD3009','MAT3002','MAT3003','CSE3003','CDS3005','CSE3011','CSE3001','PHY1003','CSD1001']),
  ('bce', array['CSE2001','CSE2002','CSE2006','CSA2001','CSE3001','ECE2002','MEE2014','CSE2003','MAT3002']),
  ('bcg', array['CSG2006','PHY1005','CSE2002','CSE3003','CSE3004','MAT3002','SST1003','ECE2002']),
  ('bey', array['ECE2002','ECE2003','CSE2002','CSE2006','CSE3001','MAT2003','CHY1006','EEE1001','ECE3004']),
  ('bsa', array['MAT2002','CCA2002','CSE3003','CSD3009','SST1003','CDS3005','CSE3001']),
  ('mim', array['MAT2002','CSE2002','CSA2001','SST1003','MGT1002','MGT2003','CSE3004'])
) as m(p, codes), unnest(m.codes) as s
on conflict do nothing;

insert into public.features (key, title, blurb, status, sort) values
  ('cgpa', 'CGPA calculator', 'Add your grades and credits, see your CGPA and what you need next semester.', 'soon', 1),
  ('timetable', 'Timetable maker', 'Pick your slots and get a clash-free weekly timetable you can save.', 'soon', 2)
on conflict (key) do nothing;
