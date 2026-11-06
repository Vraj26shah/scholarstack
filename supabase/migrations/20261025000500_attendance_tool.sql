-- The attendance calculator joins the toolbox. It starts as "coming soon"; launch it from
-- Admin → Features & email when you're ready (that also emails students who asked).
insert into public.features (key, title, blurb, status, sort) values
  ('attendance', 'Attendance calculator', 'See if you can sit the exam, how many classes you can miss, and your attendance marks.', 'soon', 2)
on conflict (key) do nothing;
update public.features set sort = 3 where key = 'timetable' and sort = 2;
