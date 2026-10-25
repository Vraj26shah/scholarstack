# 🚀 Quick Start: Fix Your Site in 15 Minutes

## THE PROBLEM
Users can't sign in. Error: "Security check failed"

## THE SOLUTION (3 steps)

### Step 1: Fix Turnstile (5 min) ⚡ CRITICAL

1. **Cloudflare Dashboard** → Turnstile → Your widget → Copy **Secret Key**
2. **Supabase Dashboard** → Authentication → Attack Protection → CAPTCHA:
   - Provider: `Turnstile`
   - Site Key: `0x4AAAAAAFfDLTa4JUN4HKO-`
   - Secret Key: [paste here]
   - **Save**
3. **Cloudflare** → Turnstile → Domains → Add: `scholarstack.campusnotes.workers.dev`
4. **Test**: Try signing in on your site

✅ **Users can now sign in!**

---

### Step 2: Verify Health (5 min)

1. Open Supabase Dashboard → SQL Editor
2. Run the contents of `DATABASE_HEALTH_CHECK.sql`
3. Look for any ❌ or ⚠️ in results
4. Everything ✅? You're good!

✅ **Database is healthy!**

---

### Step 3: Check Errors (5 min)

1. Open Supabase Dashboard → SQL Editor
2. Run:
```sql
SELECT 
  count(*) as total_problems,
  count(*) FILTER (WHERE last_at > now() - interval '24 hours') as recent_24h,
  count(*) FILTER (WHERE source = 'server') as server_errors
FROM public.problem_reports;
```
3. If `server_errors` > 0, check `/admin/problems` in your app
4. If `recent_24h` > 20, investigate common issues

✅ **Errors under control!**

---

## THAT'S IT! 🎉

Your site is now:
- ✅ Users can sign in
- ✅ Database is healthy
- ✅ Errors are being tracked

---

## NEXT WEEK (When you have time)

### Improve Error Messages (2-4 hours)

**Why**: Users currently see technical errors like:
```
"Supabase is using its test email service, which only 
sends to authorized team addresses. Configure custom 
SMTP in Supabase Auth."
```

**They should see**:
```
"We couldn't send your sign-in link. Please contact support."
```

**How**: Follow `PRODUCTION_ERROR_CHECKLIST.md`

---

## FILES YOU GOT

| File | Purpose | When to Use |
|------|---------|-------------|
| `TURNSTILE_FIX.md` | Detailed Turnstile fix instructions | First time setup, troubleshooting |
| `DATABASE_HEALTH_CHECK.sql` | Verify database state | Before/after deployments, weekly |
| `user-friendly-errors.ts` | User-friendly error messages | When improving error handling |
| `PRODUCTION_ERROR_CHECKLIST.md` | Complete implementation guide | When implementing error improvements |
| `QUICK_START.md` | This file! | Right now! |

---

## MONITORING (Daily - 5 min)

**Every day, run this**:
```sql
-- Check for new errors in last 24h
SELECT kind, message, count, last_at 
FROM public.problem_reports 
WHERE last_at > now() - interval '24 hours'
ORDER BY count DESC
LIMIT 10;
```

**Red flags**:
- ❌ Same error appears 50+ times
- ❌ New server errors appear
- ❌ Failed conversions increase

---

## SUPPORT COMMANDS

### View Recent Signups
```sql
SELECT email, created_at 
FROM public.profiles 
ORDER BY created_at DESC 
LIMIT 10;
```

### View Failed Conversions
```sql
SELECT f.name, f.conversion_status, f.conversion_error, c.name as course
FROM public.course_files f
JOIN public.courses c ON c.id = f.course_id
WHERE f.conversion_status = 'failed'
ORDER BY f.updated_at DESC;
```

### View Recent Orders
```sql
SELECT o.id, p.email, o.status, o.total_paise / 100.0 as amount_rupees, o.created_at
FROM public.orders o
JOIN public.profiles p ON p.id = o.user_id
ORDER BY o.created_at DESC
LIMIT 10;
```

### Clear Old Errors (Keep last 30 days)
```sql
DELETE FROM public.problem_reports 
WHERE last_at < now() - interval '30 days';
```

---

## CHEAT SHEET

### Environment Variables (Already in your .env)
```bash
# Supabase
VITE_SUPABASE_URL=https://gunogitcgaietobakvbl.supabase.co
SUPABASE_SECRET_KEY=sb_secret_***  # Secret (never commit)

# Turnstile
VITE_TURNSTILE_SITE_KEY=0x4AAAAAAFfDLTa4JUN4HKO-  # Public
# Secret goes in Supabase dashboard, not .env!

# Admin
ADMIN_EMAILS=vitbsmashers@gmail.com

# Production URL
APP_URL_PRODUCTION=https://scholarstack.campusnotes.workers.dev
```

### Important Endpoints
- Production site: https://scholarstack.campusnotes.workers.dev
- Admin panel: https://scholarstack.campusnotes.workers.dev/admin
- Supabase Dashboard: https://supabase.com/dashboard/project/gunogitcgaietobakvbl
- Cloudflare Dashboard: https://dash.cloudflare.com

### Who to Contact
- **Database issues**: Supabase support
- **Turnstile issues**: Cloudflare support
- **Payment issues**: Razorpay support
- **Everything else**: Check problem_reports table first!

---

## QUICK WINS 🎯

After fixing Turnstile, these are easy wins:

1. ✅ **Add custom domain** (Optional)
   - Cloudflare Workers → Custom Domains
   - Add your domain (e.g., library.vitbhopal.ac.in)
   
2. ✅ **Enable Brevo emails** (If not already)
   - Verify sender domain in Brevo
   - Update EMAIL_FROM in .env
   - Run `pnpm secrets:push`

3. ✅ **Import your first course**
   - Go to `/admin/import`
   - Select folders from R2
   - Set prices and publish

---

## YOU'RE DONE! 🎊

Your production site is now:
- ✅ Secure (RLS, authentication working)
- ✅ Functional (users can sign in and purchase)
- ✅ Monitored (errors tracked)
- ✅ Professional (when you add friendly errors)

**Congrats!** 🎉

Need help? Review the detailed files or ask questions.
