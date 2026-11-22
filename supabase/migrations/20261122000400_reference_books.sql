-- ════════════════════════════════════════════════════════════════════════════
-- Reference books: real covers, free legal copies, and a researched list for every course
--
-- 1. A book can carry its ISBN (for the cover, a Google Books preview and an Open Library loan)
--    and a free, legal copy: an open textbook or one its authors publish free (free_url), to read
--    online or download as a PDF (free_kind). Pirated copies are never linked.
-- 2. Every live course gets a researched list (standard textbooks for Indian B.Tech courses, plus
--    the best free ones), checked 22 Nov 2026: every ISBN against Open Library, every free link
--    loaded. It is added only to a course with no books yet, so an admin's own list is never
--    touched, and a course that isn't in this database is skipped. Running it again adds nothing.
--
-- Rollback: alter table public.course_books drop column isbn, drop column free_url,
--           drop column free_kind;  (the added rows can stay, or be deleted in Admin)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.course_books add column if not exists isbn text;
alter table public.course_books add column if not exists free_url text;
alter table public.course_books add column if not exists free_kind text;

alter table public.course_books drop constraint if exists course_books_isbn_chk;
alter table public.course_books add constraint course_books_isbn_chk
  check (isbn is null or isbn ~ '^(97[89])?[0-9]{9}[0-9X]$');
alter table public.course_books drop constraint if exists course_books_free_chk;
alter table public.course_books add constraint course_books_free_chk check (
  (free_url is null and free_kind is null) or
  (free_url ~* '^https://' and length(free_url) <= 500 and free_kind in ('read', 'pdf'))
);

comment on column public.course_books.isbn is 'ISBN-10 or ISBN-13, digits only: cover, preview, borrow and buy links.';
comment on column public.course_books.free_url is 'A free, legal copy (open textbook or published free by its authors). Never a pirated copy.';
comment on column public.course_books.free_kind is 'read: read online; pdf: download the PDF.';

with seed (slug, sort, title, author, isbn, free_url, free_kind) as (
  values
    ('electric-circuits-and-systems-2023-bey', 0, 'Engineering Circuit Analysis', 'Hayt, Kemmerly & Durbin', '9780073529578', null, null),
    ('electric-circuits-and-systems-2023-bey', 1, 'Fundamentals of Electric Circuits', 'Alexander & Sadiku', '9780073380575', null, null),
    ('electric-circuits-and-systems-2023-bey', 2, 'Lessons in Electric Circuits, Vol. I: DC', 'Tony R. Kuphaldt', null, 'https://www.ibiblio.org/kuphaldt/electricCircuits/DC/DC.pdf', 'pdf'),
    ('professional-communication-skills-for-engineers-2023-bcg', 0, 'Technical Communication: Principles and Practice', 'Meenakshi Raman & Sangeeta Sharma', '9780199457496', null, null),
    ('professional-communication-skills-for-engineers-2023-bcg', 1, 'Technical Writing Essentials', 'Suzan Last', null, 'https://pressbooks.bccampus.ca/technicalwriting/', 'read'),
    ('fundamentals-in-ai-and-ml-2023-bai', 0, 'Artificial Intelligence: A Modern Approach', 'Stuart Russell & Peter Norvig', '9780134610993', null, null),
    ('fundamentals-in-ai-and-ml-2023-bai', 1, 'An Introduction to Statistical Learning', 'James, Witten, Hastie & Tibshirani', null, 'https://www.statlearning.com/', 'pdf'),
    ('fundamentals-in-ai-and-ml-2023-bai', 2, 'Mathematics for Machine Learning', 'Deisenroth, Faisal & Ong', null, 'https://mml-book.github.io/', 'pdf'),
    ('introduction-to-computational-physics-2023-bai', 0, 'Computational Physics', 'Mark Newman', '9781480145511', null, null),
    ('introduction-to-computational-physics-2023-bai', 1, 'Basic Concepts in Computational Physics', 'Benjamin A. Stickler & Ewald Schachinger', '9783319272634', null, null),
    ('object-oriented-programming-with-c-2023-bai', 0, 'Programming: Principles and Practice Using C++', 'Bjarne Stroustrup', '9780321992789', null, null),
    ('object-oriented-programming-with-c-2023-bai', 1, 'C++: The Complete Reference', 'Herbert Schildt', '9780072226805', null, null),
    ('object-oriented-programming-with-c-2023-bai', 2, 'Learn C++', 'learncpp.com', null, 'https://www.learncpp.com/', 'read'),
    ('advanced-technical-communication-2023-bai', 0, 'Technical Communication: Principles and Practice', 'Meenakshi Raman & Sangeeta Sharma', '9780199457496', null, null),
    ('advanced-technical-communication-2023-bai', 1, 'Technical Writing Essentials', 'Suzan Last', null, 'https://pressbooks.bccampus.ca/technicalwriting/', 'read'),
    ('probability-statistics-and-reliability-2023-bai', 0, 'Probability & Statistics for Engineers & Scientists', 'Walpole, Myers, Myers & Ye', '9780321629111', null, null),
    ('probability-statistics-and-reliability-2023-bai', 1, 'Introduction to Probability', 'Joseph K. Blitzstein & Jessica Hwang', null, 'https://probabilitybook.net/', 'pdf'),
    ('probability-statistics-and-reliability-2023-bai', 2, 'Introductory Statistics 2e', 'OpenStax', null, 'https://openstax.org/details/books/introductory-statistics-2e', 'pdf'),
    ('discrete-mathematics-and-graph-theory-2023-bsa', 0, 'Discrete Mathematics and Its Applications', 'Kenneth H. Rosen', '9780073383095', null, null),
    ('discrete-mathematics-and-graph-theory-2023-bsa', 1, 'Introduction to Graph Theory', 'Douglas B. West', '9780130144003', null, null),
    ('discrete-mathematics-and-graph-theory-2023-bsa', 2, 'Discrete Mathematics: An Open Introduction', 'Oscar Levin', null, 'https://discrete.openmathbooks.org/dmoi4.html', 'read'),
    ('principles-of-digital-forensics-2023-bai', 0, 'Guide to Computer Forensics and Investigations', 'Nelson, Phillips & Steuart', '9781337568944', null, null),
    ('principles-of-digital-forensics-2023-bai', 1, 'File System Forensic Analysis', 'Brian Carrier', '9780321268174', null, null),
    ('principles-of-digital-forensics-2023-bai', 2, 'Guide to Integrating Forensic Techniques into Incident Response (NIST SP 800-86)', 'NIST', null, 'https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-86.pdf', 'pdf'),
    ('effective-technical-communication-2023-boe', 0, 'Technical Communication: Principles and Practice', 'Meenakshi Raman & Sangeeta Sharma', '9780199457496', null, null),
    ('effective-technical-communication-2023-boe', 1, 'Technical Writing Essentials', 'Suzan Last', null, 'https://pressbooks.bccampus.ca/technicalwriting/', 'read'),
    ('engineering-physics-2023-boe', 0, 'Fundamentals of Physics', 'Halliday, Resnick & Walker', '9781118230718', null, null),
    ('engineering-physics-2023-boe', 1, 'University Physics, Volume 3', 'OpenStax', null, 'https://openstax.org/details/books/university-physics-volume-3', 'pdf'),
    ('digital-logic-design-2023-bce', 0, 'Digital Design', 'M. Morris Mano & Michael D. Ciletti', '9780132774208', null, null),
    ('digital-logic-design-2023-bce', 1, 'Lessons in Electric Circuits, Vol. IV: Digital', 'Tony R. Kuphaldt', null, 'https://www.ibiblio.org/kuphaldt/electricCircuits/Digital/DIGI.pdf', 'pdf'),
    ('internet-and-web-programming-2023-bce', 0, 'Internet & World Wide Web: How to Program', 'Paul Deitel, Harvey Deitel & Abbey Deitel', '9780132151009', null, null),
    ('internet-and-web-programming-2023-bce', 1, 'Eloquent JavaScript', 'Marijn Haverbeke', null, 'https://eloquentjavascript.net/', 'read'),
    ('internet-and-web-programming-2023-bce', 2, 'Learn web development (MDN)', 'Mozilla', null, 'https://developer.mozilla.org/en-US/docs/Learn_web_development', 'read'),
    ('theory-of-computation-and-compiler-design-2023-bai', 0, 'Introduction to the Theory of Computation', 'Michael Sipser', '9781133187790', null, null),
    ('theory-of-computation-and-compiler-design-2023-bai', 1, 'Compilers: Principles, Techniques, and Tools', 'Aho, Lam, Sethi & Ullman', '9780321486813', null, null),
    ('theory-of-computation-and-compiler-design-2023-bai', 2, 'Introduction to Theory of Computation', 'Anil Maheshwari & Michiel Smid', null, 'https://cglab.ca/~michiel/TheoryOfComputation/TheoryOfComputation.pdf', 'pdf'),
    ('theory-of-computation-and-compiler-design-2023-bai', 3, 'Crafting Interpreters', 'Robert Nystrom', null, 'https://craftinginterpreters.com/', 'read'),
    ('data-structures-and-algorithms-2023-bcg', 0, 'Introduction to Algorithms', 'Cormen, Leiserson, Rivest & Stein', '9780262046305', null, null),
    ('data-structures-and-algorithms-2023-bcg', 1, 'Open Data Structures', 'Pat Morin', null, 'https://opendatastructures.org/', 'pdf'),
    ('technology-entrepreneurship-2023-mim', 0, 'The Lean Startup', 'Eric Ries', '9780307887894', null, null),
    ('technology-entrepreneurship-2023-mim', 1, 'Entrepreneurship', 'OpenStax', null, 'https://openstax.org/details/books/entrepreneurship', 'pdf'),
    ('programming-in-java-2023-bce', 0, 'Java: The Complete Reference', 'Herbert Schildt', '9781260463415', null, null),
    ('programming-in-java-2023-bce', 1, 'Java How to Program, Early Objects', 'Paul Deitel & Harvey Deitel', '9780133807806', null, null),
    ('programming-in-java-2023-bce', 2, 'Introduction to Programming Using Java', 'David J. Eck', null, 'https://math.hws.edu/javanotes/', 'read'),
    ('microprocessors-and-microcontrollers-2023-bce', 0, 'The 8051 Microcontroller and Embedded Systems', 'Mazidi, Mazidi & McKinlay', '9780131194021', null, null),
    ('microprocessors-and-microcontrollers-2023-bce', 1, 'The Intel Microprocessors', 'Barry B. Brey', '9780135026458', null, null),
    ('engineering-design-and-modelling-2023-bce', 0, 'Engineering Design', 'George E. Dieter & Linda C. Schmidt', '9780073398143', null, null),
    ('operating-systems-2023-bai', 0, 'Operating System Concepts', 'Silberschatz, Galvin & Gagne', '9781119800361', null, null),
    ('operating-systems-2023-bai', 1, 'Operating Systems: Three Easy Pieces', 'Remzi & Andrea Arpaci-Dusseau', null, 'https://pages.cs.wisc.edu/~remzi/OSTEP/', 'pdf'),
    ('aws-cloud-practitioner-2023-bai', 0, 'AWS Certified Cloud Practitioner Study Guide', 'Ben Piper & David Clinton', '9781119490708', null, null),
    ('aws-cloud-practitioner-2023-bai', 1, 'Overview of Amazon Web Services (whitepaper)', 'Amazon Web Services', null, 'https://docs.aws.amazon.com/whitepapers/latest/aws-overview/introduction.html', 'read'),
    ('cloud-architecture-and-services-2023-bsa', 0, 'Cloud Computing: Concepts, Technology & Architecture', 'Thomas Erl, Zaigham Mahmood & Ricardo Puttini', '9780133387520', null, null),
    ('cloud-architecture-and-services-2023-bsa', 1, 'Cloud Computing Bible', 'Barrie Sosinsky', '9780470903568', null, null),
    ('cloud-architecture-and-services-2023-bsa', 2, 'AWS Well-Architected Framework', 'Amazon Web Services', null, 'https://docs.aws.amazon.com/wellarchitected/latest/framework/framework.html', 'read'),
    ('database-management-systems-2023-bai', 0, 'Database System Concepts', 'Silberschatz, Korth & Sudarshan', '9780078022159', null, null),
    ('database-management-systems-2023-bai', 1, 'Fundamentals of Database Systems', 'Ramez Elmasri & Shamkant B. Navathe', '9780133970777', null, null),
    ('database-management-systems-2023-bai', 2, 'Database Design, 2nd Edition', 'Adrienne Watt & Nelson Eng', null, 'https://opentextbc.ca/dbdesign01/', 'read'),
    ('computer-architecture-and-organization-2023-bce', 0, 'Computer Organization and Architecture', 'William Stallings', '9780134101613', null, null),
    ('computer-architecture-and-organization-2023-bce', 1, 'Computer Organization and Design', 'David A. Patterson & John L. Hennessy', '9780124077263', null, null),
    ('applied-linear-algebra-2023-bai', 0, 'Introduction to Linear Algebra', 'Gilbert Strang', '9780980232776', null, null),
    ('applied-linear-algebra-2023-bai', 1, 'Introduction to Applied Linear Algebra: Vectors, Matrices, and Least Squares', 'Stephen Boyd & Lieven Vandenberghe', null, 'https://web.stanford.edu/~boyd/vmls/', 'pdf'),
    ('applied-linear-algebra-2023-bai', 2, 'Linear Algebra', 'Jim Hefferon', null, 'https://hefferon.net/linearalgebra/', 'pdf'),
    ('applied-numerical-methods-2023-bce', 0, 'Numerical Methods for Engineers', 'Steven C. Chapra & Raymond P. Canale', '9780073397924', null, null),
    ('applied-numerical-methods-2023-bce', 1, 'Numerical Methods with Applications', 'Autar Kaw', null, 'https://nm.mathforcollege.com/', 'read'),
    ('design-and-analysis-of-algorithm-2023-bcg', 0, 'Introduction to Algorithms', 'Cormen, Leiserson, Rivest & Stein', '9780262046305', null, null),
    ('design-and-analysis-of-algorithm-2023-bcg', 1, 'Algorithm Design', 'Jon Kleinberg & Éva Tardos', '9780321295354', null, null),
    ('design-and-analysis-of-algorithm-2023-bcg', 2, 'Algorithms', 'Jeff Erickson', null, 'https://jeffe.cs.illinois.edu/teaching/algorithms/', 'pdf'),
    ('competitive-coding-practice-2023-bcg', 0, 'Guide to Competitive Programming', 'Antti Laaksonen', '9783030393564', null, null),
    ('competitive-coding-practice-2023-bcg', 1, 'Competitive Programmer''s Handbook', 'Antti Laaksonen', null, 'https://cses.fi/book/book.pdf', 'pdf'),
    ('python-programming-2023-bai', 0, 'Learning Python', 'Mark Lutz', '9781449355739', null, null),
    ('python-programming-2023-bai', 1, 'Think Python', 'Allen B. Downey', null, 'https://greenteapress.com/wp/think-python-2e/', 'pdf'),
    ('python-programming-2023-bai', 2, 'Automate the Boring Stuff with Python', 'Al Sweigart', null, 'https://automatetheboringstuff.com/', 'read'),
    ('foundations-of-data-science-2023-bai', 0, 'Foundations of Data Science', 'Avrim Blum, John Hopcroft & Ravindran Kannan', null, 'https://www.cs.cornell.edu/jeh/book.pdf', 'pdf'),
    ('foundations-of-data-science-2023-bai', 1, 'Python for Data Analysis', 'Wes McKinney', null, 'https://wesmckinney.com/book/', 'read'),
    ('foundations-of-data-science-2023-bai', 2, 'Python Data Science Handbook', 'Jake VanderPlas', null, 'https://jakevdp.github.io/PythonDataScienceHandbook/', 'read'),
    ('differential-and-difference-equations-2023-bai', 0, 'Advanced Engineering Mathematics', 'Erwin Kreyszig', '9780470458365', null, null),
    ('differential-and-difference-equations-2023-bai', 1, 'An Introduction to Difference Equations', 'Saber Elaydi', '9780387230597', null, null),
    ('differential-and-difference-equations-2023-bai', 2, 'Notes on Diffy Qs: Differential Equations for Engineers', 'Jiří Lebl', null, 'https://www.jirka.org/diffyqs/', 'pdf'),
    ('network-analysis-2025-bai', 0, 'Engineering Circuit Analysis', 'Hayt, Kemmerly & Durbin', '9780073529578', null, null),
    ('network-analysis-2025-bai', 1, 'Fundamentals of Electric Circuits', 'Alexander & Sadiku', '9780073380575', null, null),
    ('network-analysis-2025-bai', 2, 'Lessons in Electric Circuits, Vol. II: AC', 'Tony R. Kuphaldt', null, 'https://www.ibiblio.org/kuphaldt/electricCircuits/AC/AC.pdf', 'pdf'),
    ('mobile-application-development-2025-bai', 0, 'Android Programming: The Big Nerd Ranch Guide', 'Bryan Sills, Brian Gardner, Kristin Marsicano & Chris Stewart', '9780137645541', null, null),
    ('mobile-application-development-2025-bai', 1, 'Android Basics with Compose', 'Google', null, 'https://developer.android.com/courses/android-basics-compose/course', 'read'),
    ('introduction-to-problem-solving-and-programming-2023-bai', 0, 'The C Programming Language', 'Brian W. Kernighan & Dennis M. Ritchie', '9780131103627', null, null),
    ('introduction-to-problem-solving-and-programming-2023-bai', 1, 'Think Python', 'Allen B. Downey', null, 'https://greenteapress.com/wp/think-python-2e/', 'pdf'),
    ('introduction-to-problem-solving-and-programming-2023-bai', 2, 'Problem Solving with Algorithms and Data Structures using Python', 'Brad Miller & David Ranum', null, 'https://runestone.academy/ns/books/published/pythonds/index.html', 'read'),
    ('analog-electronics-2023-bce', 0, 'Electronic Devices and Circuit Theory', 'Robert L. Boylestad & Louis Nashelsky', '9780132622264', null, null),
    ('analog-electronics-2023-bce', 1, 'Microelectronic Circuits', 'Adel S. Sedra & Kenneth C. Smith', '9780199339136', null, null),
    ('analog-electronics-2023-bce', 2, 'Lessons in Electric Circuits, Vol. III: Semiconductors', 'Tony R. Kuphaldt', null, 'https://www.ibiblio.org/kuphaldt/electricCircuits/Semi/SEMI.pdf', 'pdf'),
    ('physics-of-game-development-2023-bcg', 0, 'Physics for Game Developers', 'David M. Bourg & Bryan Bywalec', '9781449392512', null, null),
    ('physics-of-game-development-2023-bcg', 1, 'The Nature of Code', 'Daniel Shiffman', null, 'https://natureofcode.com/', 'read'),
    ('signals-and-systems-2023-bey', 0, 'Signals and Systems', 'Alan V. Oppenheim, Alan S. Willsky & S. Hamid Nawab', '9780138147570', null, null),
    ('signals-and-systems-2023-bey', 1, 'Signals and Systems', 'Simon Haykin & Barry Van Veen', '9780471164746', null, null),
    ('signals-and-systems-2023-bey', 2, 'Think DSP', 'Allen B. Downey', null, 'https://greenteapress.com/wp/think-dsp/', 'pdf'),
    ('principles-of-management-and-organizational-behaviour-2023-m', 0, 'Organizational Behavior', 'Stephen P. Robbins & Timothy A. Judge', '9780134729329', null, null),
    ('principles-of-management-and-organizational-behaviour-2023-m', 1, 'Principles of Management', 'OpenStax', null, 'https://openstax.org/details/books/principles-management', 'pdf'),
    ('principles-of-management-and-organizational-behaviour-2023-m', 2, 'Organizational Behavior', 'OpenStax', null, 'https://openstax.org/details/books/organizational-behavior', 'pdf'),
    ('emotional-intelligence-2023-bai', 0, 'Emotional Intelligence: Why It Can Matter More Than IQ', 'Daniel Goleman', '9780553383713', null, null),
    ('emotional-intelligence-2023-bai', 1, 'Emotional Intelligence 2.0', 'Travis Bradberry & Jean Greaves', '9780974320625', null, null)
),
target as (
  select s.*, c.id as course_id
    from seed s
    join public.courses c on c.slug = s.slug
   where not exists (select 1 from public.course_books b where b.course_id = c.id)
)
insert into public.course_books (course_id, title, author, url, isbn, free_url, free_kind, sort)
select course_id, title, author,
       coalesce(free_url, 'https://openlibrary.org/isbn/' || isbn),
       isbn, free_url, free_kind, sort
  from target;
