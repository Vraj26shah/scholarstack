# 🔧 CRITICAL FIX REQUIRED: Turnstile Security Check

## Problem
Your screenshot shows this error:
```
Security check failed. Check that this site is allowed in the
Turnstile widget and that its secret is configured in Supabase Auth.
```

This prevents ALL users from signing in. **This must be fixed immediately.**

---

## Root Cause
Your Turnstile security check (CAPTCHA) is not properly configured. Two issues:

1. **Missing Turnstile Secret in Supabase**
2. **Production domain not added to Turnstile widget allowlist**

---

## Fix Steps (Takes 5 minutes)

### Step 1: Add Turnstile Secret to Supabase

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Turnstile** → Find your widget
3. Copy the **Secret Key** (starts with `0x4...` or similar)
4. Go to [Supabase Dashboard](https://supabase.com/dashboard)
5. Select your project: `gunogitcgaietobakvbl`
6. Go to **Authentication** → **Attack Protection** → **CAPTCHA**
7. Set these values:
   - **Provider**: Turnstile
   - **Site Key**: `0x4AAAAAAFfDLTa4JUN4HKO-` (you already have this in .env)
   - **Secret Key**: Paste the secret key from Cloudflare

8. Click **Save**

### Step 2: Add Production Domain to Turnstile

1. Still in Cloudflare → **Turnstile** → Your widget
2. Under **Domains**, add these:
   - `localhost` (for development - you probably have this)
   - `scholarstack.campusnotes.workers.dev` (your production URL)
   - Any custom domain you use

3. Save changes

### Step 3: Test

1. Go to `https://scholarstack.campusnotes.workers.dev`
2. Try to sign in with email
3. The Turnstile challenge should appear
4. Sign-in should work

---

## Verification Checklist

- [ ] Turnstile secret configured in Supabase Auth
- [ ] Production domain added to Turnstile widget
- [ ] Can sign in with email on production site
- [ ] Can sign in with Google on production site
- [ ] Turnstile challenge appears (checkbox or automatic)

---

## If Still Not Working

### Check 1: Supabase Logs
1. Supabase Dashboard → **Logs** → **Authentication**
2. Look for Turnstile-related errors
3. Common issue: "Invalid secret" means wrong secret key

### Check 2: Browser Console
1. Open browser DevTools (F12)
2. Try to sign in
3. Look for errors mentioning `turnstile` or `challenges.cloudflare.com`
4. Common issue: "Network error" means domain not allowed

### Check 3: Environment Variables
Verify your `.env` has:
```bash
VITE_TURNSTILE_SITE_KEY=0x4AAAAAAFfDLTa4JUN4HKO-
```

This is the **public** site key (safe to expose). The **secret** key goes ONLY in Supabase dashboard.

---

## Alternative: Disable Turnstile Temporarily

**Only for testing - NOT for production:**

1. Supabase Dashboard → **Authentication** → **Attack Protection**
2. Disable CAPTCHA
3. Users can sign in without Turnstile
4. **⚠️ WARNING**: This allows bots. Only use temporarily while fixing Turnstile.

---

## Why This Error Appears

The error message says "Security check failed" because:
1. Your sign-in code sends a request to Supabase
2. Supabase tries to verify the Turnstile token with Cloudflare
3. Cloudflare rejects it because:
   - Secret key is missing/wrong in Supabase, OR
   - Your domain isn't allowed in the widget

The error message is technical (exposes architecture) because I haven't deployed the user-friendly error improvements yet. After this fix, we'll update error messages.

---

## After You Fix This

Once Turnstile is working:
1. Users will see the Turnstile challenge (checkbox or automatic)
2. Sign-in will work normally
3. We can then deploy the improved error messages

Let me know when you've completed these steps!
