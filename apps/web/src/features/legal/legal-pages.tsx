import type { ReactNode } from 'react';
import { env } from '../../lib/env';
import { Page } from '../../shared/ui/chrome';

/** Replace before launch. */
const CONTACT_EMAIL = '[YOUR CONTACT EMAIL]';

function Legal({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <Page>
      <article className="pt-4 max-w-[720px] flex flex-col gap-5 text-[16px] leading-relaxed [&_h2]:font-display [&_h2]:font-extrabold [&_h2]:text-[22px] [&_h2]:tracking-[-0.03em] [&_h2]:mt-6 [&_h2]:mb-0 [&_p]:m-0 [&_ul]:m-0 [&_ul]:pl-5">
        <div>
          <p className="font-mono text-[11px] tracking-[0.14em] text-ink2 m-0">UPDATED {updated}</p>
          <h1 className="m-0 font-display font-extrabold text-[clamp(40px,7vw,60px)] leading-[0.95] tracking-[-0.05em]">
            {title}
            <span className="text-teal-text">.</span>
          </h1>
        </div>
        {children}
      </article>
    </Page>
  );
}

export function TermsPage() {
  return (
    <Legal title="Terms" updated="20 OCT 2026">
      <p>
        {env.appName} sells access to handwritten study notes for students of VIT Bhopal University. By
        signing in or buying, you agree to these terms.
      </p>
      <h2>Who can use it</h2>
      <p>
        Only people with an active @{env.domain} email address. Your account is personal: one person, up to
        two devices, one open session at a time.
      </p>
      <h2>What you're buying</h2>
      <p>
        A purchase gives you personal, read-only access to the course's notes inside {env.appName} for as long
        as the service runs. It does not give you a copy of the files. You can't download, print, record,
        share or resell them.
      </p>
      <h2>All sales are final</h2>
      <p>
        You can see every unit, file name and page count before you buy, so all sales are final and there are
        no refunds. If a payment goes through but the course doesn't appear on your shelf, write to us and
        we'll fix it.
      </p>
      <h2>Watermarks and misuse</h2>
      <p>
        Every page you read carries your name and email. If notes from your account turn up elsewhere, or your
        account is shared or used in a way meant to get around these limits, we can suspend it without a
        refund. Disputed or reversed payments remove access to that course.
      </p>
      <h2>Not official</h2>
      <p>
        {env.appName} is an independent student project and is not affiliated with or endorsed by VIT Bhopal
        University.
      </p>
      <h2>Changes</h2>
      <p>We may update these terms; the date above shows the latest version. Questions: {CONTACT_EMAIL}.</p>
    </Legal>
  );
}

export function PrivacyPage() {
  return (
    <Legal title="Privacy" updated="20 OCT 2026">
      <p>We keep only what's needed to run your account and stop it being shared.</p>
      <h2>What we store</h2>
      <ul>
        <li>Your college email and the name you give us.</li>
        <li>
          Your devices: a label (like "Chrome on Windows"), a random device ID and when each was last used.
        </li>
        <li>
          Your purchases and the Razorpay order and payment IDs. We never see or store card or UPI details.
        </li>
        <li>
          Reading activity: which page you're on and how many pages you've viewed, to resume where you left
          off and limit scraping.
        </li>
        <li>Your IP address and browser when you open files, used only for security.</li>
      </ul>
      <h2>Who processes it</h2>
      <p>
        Supabase (accounts and database), Cloudflare (hosting, storage, bot protection), Razorpay (payments)
        and Google (if you sign in with Google).
      </p>
      <h2>Cookies</h2>
      <p>One signed device cookie and your sign-in session. No advertising or tracking cookies.</p>
      <h2>Your choices</h2>
      <p>
        Ask us at {CONTACT_EMAIL} to see or delete your data. Deleting your account removes access to your
        purchases.
      </p>
    </Legal>
  );
}

export function ContactPage() {
  return (
    <Legal title="Contact" updated="20 OCT 2026">
      <p>
        Payment went through but the course isn't on your shelf? A file won't open? Found a mistake in the
        notes?
      </p>
      <p>
        Write to <strong className="font-mono">{CONTACT_EMAIL}</strong> from your college email. Include the
        order ID from your Razorpay receipt for payment questions. We usually reply within a day.
      </p>
    </Legal>
  );
}
