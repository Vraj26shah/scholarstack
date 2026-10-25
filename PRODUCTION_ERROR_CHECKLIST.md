# Production Error Handling Checklist

## ✅ What's Already Done

### Database & Infrastructure
- ✅ Problem reporting system (`problem_reports` table)
- ✅ Error fingerprinting to group similar issues
- ✅ PII and secret scrubbing
- ✅ Admin-only visibility for error logs
- ✅ Audit logging for all admin actions
- ✅ RLS policies on all tables

### Error Handling Architecture
- ✅ Centralized error codes (`ErrorCode` enum)
- ✅ Custom `AppError` class for application errors
- ✅ HTTP error middleware
- ✅ Admin vs user context awareness
- ✅ Problem logging for unexpected errors

---

## 🔧 What Needs Implementation

### 1. User-Friendly Error Messages (HIGH PRIORITY)

**Status**: ❌ Not fully implemented

**What to do**:
- [ ] Update `apps/web/src/lib/api.ts` → `friendly()` function
  - Use the new `user-friendly-errors.ts` module
  - Implement all error codes with user-friendly messages
  - Keep admin-specific technical details

**File Created**: `apps/web/src/lib/user-friendly-errors.ts` ✅

**Example Implementation**:
```typescript
import { getUserFriendlyMessage } from './user-friendly-errors';

export function friendly(error: unknown): string {
  if (error instanceof ApiError) {
    const isAdmin = globalThis.location?.pathname.startsWith('/admin');
    return getUserFriendlyMessage(error.code, isAdmin, error.message);
  }
  return 'Something went wrong. Please try again.';
}
```

### 2. Turnstile Error Improvements (CRITICAL)

**Status**: ✅ Done in `turnstile.tsx`

**What was done**:
- Hide technical details from regular users
- Show configuration details only to admins
- Clear actionable messages

### 3. Supabase Auth Error Improvements (HIGH PRIORITY)

**Status**: ❌ Needs update

**What to do**:
- [ ] Update `apps/web/src/lib/auth/supabase-gateway.ts`
  - Distinguish admin vs user context
  - Hide configuration errors from users
  - Show SMTP/email config errors only to admins

**Current Issue**: All users see technical messages like:
```
"Supabase is using its test email service, which only sends to 
authorized team addresses. Configure custom SMTP in Supabase Auth."
```

**Should be** (for users):
```
"We couldn't send your sign-in link. Please contact support."
```

### 4. Error Tracking IDs (MEDIUM PRIORITY)

**Status**: ❌ Not implemented

**What to do**:
- [ ] Add unique error ID to all user-facing errors
- [ ] Display error ID in UI
- [ ] Include error ID in problem reports
- [ ] Allow support to search by error ID

**Example**:
```
Something went wrong. (Error ID: err_abc123def456)
Our team has been notified.
```

### 5. Admin Health Dashboard (MEDIUM PRIORITY)

**Status**: ❌ Not implemented

**What to do**:
- [ ] Create `/admin/health` page showing:
  - Recent errors (last 24h)
  - System status (database, R2, payments)
  - Conversion queue status
  - Failed conversions count
  - User sign-up rate

### 6. Real-time Error Alerts (LOW PRIORITY)

**Status**: ❌ Not implemented

**What to do**:
- [ ] Email admins when critical errors spike
- [ ] Alert when payment system is down
- [ ] Notify on repeated sync failures

---

## 🔍 Testing Checklist

### User Experience Testing

**Test each error as a regular user (not admin)**:

- [ ] **Authentication Errors**
  - [ ] Sign in with wrong email domain → See user-friendly message
  - [ ] Session expires → Clear message, easy to re-authenticate
  - [ ] Turnstile fails → Non-technical message

- [ ] **Payment Errors**
  - [ ] Try to buy without payment system → Clear message, no technical details
  - [ ] Payment verification fails → Know what to do next

- [ ] **Access Errors**
  - [ ] Try to read file you don't own → Clear message
  - [ ] Open file while reading on another device → Actionable message

- [ ] **Content Errors**
  - [ ] Try to read file still converting → Know when to come back
  - [ ] Access removed/missing file → Understand why

### Admin Testing

**Test each error as an admin**:

- [ ] See technical details in admin routes
- [ ] Problem reports show full errors
- [ ] Audit log captures all admin actions
- [ ] Can filter and search problems

### Security Testing

- [ ] No secrets exposed in user errors
- [ ] No internal paths/URLs in messages
- [ ] No database schema details revealed
- [ ] Admin emails not exposed to regular users

---

## 📊 Monitoring Setup

### Daily Checks
- [ ] Review problem_reports for new issues
- [ ] Check failed conversions
- [ ] Verify sync health

### Weekly Checks
- [ ] Review audit_log for suspicious activity
- [ ] Clean old problem reports (>30 days)
- [ ] Analyze error trends

### Monthly Checks
- [ ] Update error messages based on user feedback
- [ ] Review and optimize database indexes
- [ ] Audit RLS policies

---

## 🚀 Deployment Steps

### Before Deploying

1. [ ] **Fix Turnstile Configuration** (CRITICAL)
   - See `TURNSTILE_FIX.md`
   - Add secret to Supabase
   - Add domain to Turnstile widget

2. [ ] **Run Database Health Check**
   - Execute `DATABASE_HEALTH_CHECK.sql` in Supabase
   - Fix any red flags
   - Verify all RLS policies enabled

3. [ ] **Update Error Messages**
   - Integrate `user-friendly-errors.ts`
   - Update `api.ts` friendly() function
   - Update `supabase-gateway.ts` error handling

4. [ ] **Test All Error Scenarios**
   - Use browser in incognito mode (not admin)
   - Verify user-friendly messages
   - Check admin panel shows technical details

### After Deploying

1. [ ] **Monitor Problem Reports**
   - Check for new error patterns
   - Verify errors are being logged
   - Confirm scrubbing works (no PII)

2. [ ] **User Feedback**
   - Ask users if error messages are clear
   - Track support tickets related to confusing errors
   - Iterate on messages

---

## 🎯 Success Criteria

**You'll know error handling is production-ready when**:

✅ Users NEVER see technical error messages (unless they're admins)
✅ Every error message tells the user what to do next
✅ Admins can find detailed error information in problem reports
✅ No secrets or architecture details exposed
✅ Support can help users by referencing error IDs
✅ Error rate is being monitored
✅ Critical errors trigger alerts

---

## 📝 Notes

### Why This Matters

Good error handling:
- Reduces support burden (users know what to do)
- Improves security (no architecture exposure)
- Builds trust (professional, polished experience)
- Helps debugging (admins get full context)

### Common Mistakes to Avoid

❌ Showing technical errors to users
❌ Generic "something went wrong" without context
❌ No way to report/track errors
❌ Same error message for admins and users
❌ Exposing database/API structure

### Best Practices

✅ User messages are clear and actionable
✅ Admin messages have full technical details
✅ Every error has a unique ID
✅ Errors are logged and monitored
✅ Critical errors trigger immediate alerts
