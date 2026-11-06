-- ════════════════════════════════════════════════════════════════════════════
-- 20261103 · Every VIT Bhopal B.Tech programme, so every student lands in their own drawer.
-- The code is the three letters in the college email (vraj.23BCE11796 → BCE). Codes and names
-- can be corrected in the admin (Courses → Years & branches) without a migration.
-- Adds only what is missing; never changes or removes a programme the admin already has.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.programmes (slug, code, name, short_name, tagline, description, sort)
select v.slug, v.code, v.name, v.short_name, v.tagline, v.description, v.sort
from (values
  ('bcy', 'BCY', 'B.Tech CSE (Cyber Security and Digital Forensics)', 'B.Tech CSE CS', 'Security, forensics and core CS',
   'Semester notes for B.Tech CSE (Cyber Security and Digital Forensics) students at VIT Bhopal.', 6),
  ('bhi', 'BHI', 'B.Tech CSE (Health Informatics)', 'B.Tech CSE HI', 'Health data and core CS',
   'Semester notes for B.Tech CSE (Health Informatics) students at VIT Bhopal.', 7),
  ('boe', 'BOE', 'B.Tech CSE (Education Technology)', 'B.Tech CSE ET', 'Learning technology and core CS',
   'Semester notes for B.Tech CSE (Education Technology) students at VIT Bhopal.', 8),
  ('bec', 'BEC', 'B.Tech Electronics and Communication Engineering', 'B.Tech ECE', 'Circuits, signals and communication',
   'Semester notes for B.Tech ECE students at VIT Bhopal.', 9),
  ('bac', 'BAC', 'B.Tech ECE (AI and Cybernetics)', 'B.Tech ECE AIC', 'Electronics, AI and control',
   'Semester notes for B.Tech ECE (AI and Cybernetics) students at VIT Bhopal.', 10),
  ('bme', 'BME', 'B.Tech Mechanical Engineering', 'B.Tech ME', 'Design, thermal and manufacturing',
   'Semester notes for B.Tech Mechanical Engineering students at VIT Bhopal.', 11),
  ('bmr', 'BMR', 'B.Tech Mechanical Engineering (AI and Robotics)', 'B.Tech ME AIR', 'Mechanics, AI and robotics',
   'Semester notes for B.Tech Mechanical (AI and Robotics) students at VIT Bhopal.', 12),
  ('bas', 'BAS', 'B.Tech Aerospace Engineering', 'B.Tech AE', 'Aerodynamics, structures and propulsion',
   'Semester notes for B.Tech Aerospace Engineering students at VIT Bhopal.', 13)
) as v(slug, code, name, short_name, tagline, description, sort)
where not exists (select 1 from public.programmes p where p.slug = v.slug or p.code = v.code);

-- The official names of two existing programmes.
update public.programmes set name = 'B.Tech CSE (AI and Machine Learning)', short_name = 'B.Tech CSE AIML'
where slug = 'bai' and name = 'B.Tech Artificial Intelligence';
update public.programmes set name = 'B.Tech CSE (Gaming Technology)', short_name = 'B.Tech CSE GT'
where slug = 'bcg' and name = 'B.Tech CS (Game Development)';
