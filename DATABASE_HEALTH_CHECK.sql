-- ════════════════════════════════════════════════════════════════════════════
-- Scholars Stack: Database Health Check Script
-- Run this in Supabase SQL Editor to verify everything is properly configured
-- ════════════════════════════════════════════════════════════════════════════

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ 1. ADMIN CONFIGURATION                                                   │
-- └─────────────────────────────────────────────────────────────────────────┘

SELECT '🔐 ADMIN EMAILS' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT 
  'Admin Count',
  CASE WHEN count(*) > 0 THEN '✅' ELSE '❌ NO ADMINS CONFIGURED' END,
  count(*)::text || ' admins'
FROM public.admin_emails
UNION ALL
SELECT 'Admins List', '→', email FROM public.admin_emails;

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ 2. ACADEMIC SETUP                                                        │
-- └─────────────────────────────────────────────────────────────────────────┘

SELECT '' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT '📚 ACADEMIC STRUCTURE' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT 
  'Batch Years',
  CASE WHEN count(*) > 0 THEN '✅' ELSE '⚠️ NO YEARS' END,
  count(*)::text || ' years'
FROM public.years
UNION ALL
SELECT 
  'Branches',
  CASE WHEN count(*) > 0 THEN '✅' ELSE '⚠️ NO BRANCHES' END,
  count(*)::text || ' branches'
FROM public.branches
UNION ALL
SELECT 
  'Courses',
  CASE WHEN count(*) > 0 THEN '✅' ELSE '⚠️ NO COURSES' END,
  count(*)::text || ' courses (' || 
  sum(CASE WHEN published THEN 1 ELSE 0 END)::text || ' published)'
FROM public.courses;

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ 3. CONTENT & CONVERSION STATUS                                           │
-- └─────────────────────────────────────────────────────────────────────────┘

SELECT '' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT '📄 CONTENT STATUS' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT 
  'Total Files',
  '📁',
  count(*)::text || ' files'
FROM public.course_files
UNION ALL
SELECT 
  'Converted (Ready)',
  CASE WHEN count(*) > 0 THEN '✅' ELSE '⚠️' END,
  count(*)::text || ' files'
FROM public.course_files
WHERE conversion_status = 'completed'
UNION ALL
SELECT 
  'Converting (In Progress)',
  CASE WHEN count(*) = 0 THEN '✅ None waiting' ELSE '⏳' END,
  count(*)::text || ' files'
FROM public.course_files
WHERE conversion_status IN ('queued', 'rendering_pages', 'writing_pages', 'verifying_r2')
UNION ALL
SELECT 
  'Failed Conversions',
  CASE WHEN count(*) = 0 THEN '✅ None failed' ELSE '❌ NEEDS ATTENTION' END,
  count(*)::text || ' files'
FROM public.course_files
WHERE conversion_status = 'failed'
UNION ALL
SELECT 
  'Total Pages',
  '📃',
  count(*)::text || ' pages'
FROM public.file_pages;

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ 4. USER & SESSION HEALTH                                                 │
-- └─────────────────────────────────────────────────────────────────────────┘

SELECT '' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT '👥 USERS & SESSIONS' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT 
  'Total Users',
  '✅',
  count(*)::text || ' registered users'
FROM public.profiles
UNION ALL
SELECT 
  'Active Devices',
  '✅',
  count(*)::text || ' devices'
FROM public.devices
WHERE revoked_at IS NULL
UNION ALL
SELECT 
  'Active Sessions',
  '✅',
  count(*)::text || ' current sessions'
FROM public.active_sessions
WHERE updated_at > now() - interval '1 hour'
UNION ALL
SELECT 
  'Email Opt-ins',
  '✅',
  count(*)::text || ' users (' || 
  round(100.0 * count(*) / nullif((SELECT count(*) FROM public.profiles), 0), 1)::text || '%)'
FROM public.profiles
WHERE email_opt_in = true;

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ 5. COMMERCE & PAYMENTS                                                   │
-- └─────────────────────────────────────────────────────────────────────────┘

SELECT '' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT '💳 COMMERCE' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT 
  'Total Orders',
  '📦',
  count(*)::text || ' orders'
FROM public.orders
UNION ALL
SELECT 
  'Paid Orders',
  '✅',
  count(*)::text || ' paid (' || 
  sum(total_paise / 100.0)::numeric(10,2)::text || ' ₹)'
FROM public.orders
WHERE status = 'paid'
UNION ALL
SELECT 
  'Pending Orders',
  CASE WHEN count(*) < 10 THEN '✅' ELSE '⚠️' END,
  count(*)::text || ' created but not paid'
FROM public.orders
WHERE status = 'created'
UNION ALL
SELECT 
  'Active Entitlements',
  '✅',
  count(*)::text || ' course accesses'
FROM public.entitlements
WHERE revoked_at IS NULL 
  AND (expires_at IS NULL OR expires_at > now());

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ 6. PROBLEM REPORTS (ERRORS)                                              │
-- └─────────────────────────────────────────────────────────────────────────┘

SELECT '' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT '🚨 ERROR MONITORING' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT 
  'Total Problem Types',
  CASE WHEN count(*) < 100 THEN '✅' ELSE '⚠️ High' END,
  count(*)::text || ' unique problems'
FROM public.problem_reports
UNION ALL
SELECT 
  'Recent Errors (24h)',
  CASE WHEN count(*) = 0 THEN '✅ No recent errors' 
       WHEN count(*) < 50 THEN '⚠️ Some errors'
       ELSE '❌ MANY ERRORS' END,
  count(*)::text || ' problems'
FROM public.problem_reports
WHERE last_at > now() - interval '24 hours'
UNION ALL
SELECT 
  'Server Errors',
  CASE WHEN count(*) = 0 THEN '✅' ELSE '⚠️ CHECK LOGS' END,
  count(*)::text || ' server-side issues'
FROM public.problem_reports
WHERE source = 'server' AND last_at > now() - interval '7 days'
UNION ALL
SELECT 
  'Browser Errors',
  CASE WHEN count(*) = 0 THEN '✅' ELSE '⚠️' END,
  count(*)::text || ' client-side issues'
FROM public.problem_reports
WHERE source = 'browser' AND last_at > now() - interval '7 days';

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ 7. R2 STORAGE SYNC                                                       │
-- └─────────────────────────────────────────────────────────────────────────┘

SELECT '' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT '☁️ R2 STORAGE' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT 
  'Tracked R2 Objects',
  '✅',
  count(*)::text || ' source files'
FROM public.r2_sources
UNION ALL
SELECT 
  'Orphaned Sources',
  CASE WHEN count(*) = 0 THEN '✅ None' ELSE '⚠️ CLEANUP NEEDED' END,
  count(*)::text || ' R2 files without course assignment'
FROM public.r2_sources r
WHERE NOT EXISTS (
  SELECT 1 FROM public.course_files f WHERE f.source_key = r.key
);

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ 8. ROW LEVEL SECURITY VERIFICATION                                       │
-- └─────────────────────────────────────────────────────────────────────────┘

SELECT '' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT '🔒 SECURITY (RLS)' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT 
  tablename,
  CASE WHEN rowsecurity THEN '✅ Enabled' ELSE '❌ DISABLED' END,
  ''
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles', 'devices', 'active_sessions', 'courses', 
    'course_files', 'entitlements', 'orders', 'problem_reports'
  )
ORDER BY tablename;

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ 9. RECENT AUDIT LOG (Last 10 admin actions)                             │
-- └─────────────────────────────────────────────────────────────────────────┘

SELECT '' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT '📋 RECENT ADMIN ACTIONS' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT 
  to_char(at, 'MM-DD HH24:MI') AS timestamp,
  action || ' ' || table_name AS action,
  left(row_key, 50) AS detail
FROM public.audit_log
ORDER BY at DESC
LIMIT 10;

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ 10. RECOMMENDATIONS                                                      │
-- └─────────────────────────────────────────────────────────────────────────┘

SELECT '' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT '💡 RECOMMENDATIONS' AS check_name, '' AS status, '' AS detail
UNION ALL
SELECT 
  '→',
  'Add indexes',
  'Run: CREATE INDEX IF NOT EXISTS idx_name ON table(column);'
WHERE EXISTS (
  SELECT 1 FROM public.problem_reports 
  WHERE last_at > now() - interval '24 hours'
  LIMIT 20
)
UNION ALL
SELECT 
  '→',
  'Review failed conversions',
  'Admin panel → Conversions → Filter by Failed'
WHERE EXISTS (
  SELECT 1 FROM public.course_files WHERE conversion_status = 'failed'
)
UNION ALL
SELECT 
  '→',
  'Clear old problem reports',
  'DELETE FROM problem_reports WHERE last_at < now() - interval ''30 days'';'
WHERE (SELECT count(*) FROM public.problem_reports) > 300
UNION ALL
SELECT 
  '→',
  'Verify Turnstile config',
  'Check Supabase Auth → Attack Protection → CAPTCHA'
WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE created_at > now() - interval '1 day')
  AND (SELECT count(*) FROM public.profiles) > 0;

-- ════════════════════════════════════════════════════════════════════════════
-- All checks complete!
-- ════════════════════════════════════════════════════════════════════════════
