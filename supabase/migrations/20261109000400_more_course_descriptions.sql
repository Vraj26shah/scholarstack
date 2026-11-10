-- One-line summaries for the live courses that aren't on the Winter 2026-27 list (older batches'
-- subjects), filled in only where the description is still empty. Safe to run more than once.
update public.courses as c
   set description = v.line
  from (values
  ('CDS3005', 'Data wrangling, exploratory analysis, statistics and visualisation with Python.'),
  ('CSE1021', 'Problem solving, flowcharts and programming basics in Python.'),
  ('CSE3012', 'Building Android apps: layouts, activities, storage and APIs.'),
  ('EAC1002', 'Diodes, BJTs, MOSFETs, amplifiers and op amp circuits.'),
  ('ECE2003', 'Continuous and discrete signals, convolution, Fourier and Z transforms.'),
  ('EEE2001', 'Network theorems, transients, two port networks and resonance.'),
  ('MAT1001', 'Limits, derivatives, integrals and Laplace transforms.'),
  ('MAT1003', 'Limits, derivatives, integrals and their applications.'),
  ('MAT2001', 'Ordinary differential equations and difference equations.'),
  ('MGT1002', 'Planning, organising, leading, and how people behave at work.'),
  ('PHY1005', 'Motion, forces, collisions and rigid bodies for game physics engines.')
  ) as v(code, line)
 where upper(c.subject_code) = v.code
   and coalesce(btrim(c.description), '') = '';
