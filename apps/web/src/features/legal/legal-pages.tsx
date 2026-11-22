import { ACCESS_MONTHS } from '@ss/contracts';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { env } from '../../lib/env';
import { PROMISE } from '../../shared/copy';
import { BackLink } from '../../shared/ui/back-link';
import { Hl } from '../../shared/ui/brand';
import { Page } from '../../shared/ui/chrome';
import { Eyebrow, PageTitle } from '../../shared/ui/page-title';

/** Contact email for support and notes contributions. */
const CONTACT_EMAIL = 'vitbsmashers@gmail.com';

/**
 * Reading rhythm: body text in the quieter ink so the highlighted lines stand out, a clear gap
 * before each heading and a short one after it, and list items spaced like short paragraphs
 * (numbered with a soft disc: see .steps in index.css).
 */
const prose = [
  'pt-4 max-w-[720px] flex flex-col text-[16px] leading-[1.75] text-ink2 [&_h1]:text-ink',
  '[&_p]:m-0 [&_p+p]:mt-4 [&>div+p]:mt-5 [&>div+p]:text-[18px] [&>div+p]:leading-relaxed',
  '[&_h2]:m-0 [&_h2]:mt-12 [&_h2]:font-display [&_h2]:font-extrabold [&_h2]:text-[22px] [&_h2]:tracking-[-0.03em] [&_h2]:text-ink',
  '[&_h2+p]:mt-3 [&_h2+ul]:mt-3 [&_p+ul]:mt-4',
  '[&_ul]:m-0 [&_ul]:p-0',
  '[&_strong]:font-semibold [&_strong]:text-ink',
].join(' ');

function Legal({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <Page>
      <article className={prose}>
        <BackLink fallback="/" className="mb-5" />
        <div>
          <Eyebrow>Updated {updated}</Eyebrow>
          <PageTitle>{title}</PageTitle>
        </div>
        {children}
      </article>
    </Page>
  );
}

export function TermsPage() {
  return (
    <Legal title="Terms" updated="06 NOV 2026">
      <p>
        {env.appName} sells access to handwritten study notes for students of VIT Bhopal University. By
        signing in or buying, you agree to these terms.
      </p>
      <h2>Who can use it</h2>
      <p>
        Only people with an active @{env.domain} email address. Your account is personal:{' '}
        <Hl>one person, up to two devices</Hl>, one open session at a time.
      </p>
      <h2>What you're buying</h2>
      <p>
        A purchase gives you personal, read-only access to the course's notes inside {env.appName}. It does
        not give you a copy of the files. <Hl>You can't download, print, record, share or resell them.</Hl>
      </p>
      <h2>How long access lasts</h2>
      <p>
        Every purchase gives you <Hl>{ACCESS_MONTHS} months of access</Hl>, counted from the day you buy. The
        course page shows how many days you have left. When the {ACCESS_MONTHS} months are over we email you
        that your access has ended. Buying the course again gives you another {ACCESS_MONTHS} months, and your
        reading progress is kept. A course an admin gives you lasts until the date they set, or{' '}
        {ACCESS_MONTHS} months if they don't set one.
      </p>
      <h2 id="syllabus" className="scroll-mt-24">
        Syllabus changes
      </h2>
      <p>
        Notes are written for the syllabus that applied when they were made. VIT Bhopal University can revise
        a course's syllabus, modules or topics at any time, so some units may not match the syllabus you are
        studying now.{' '}
        <Hl>
          Before you buy, compare the units and the page-one previews with your current official syllabus.
        </Hl>{' '}
        We are not responsible for differences caused by syllabus changes, and a syllabus change is not a
        reason for a refund.
      </p>
      <h2>All sales are final</h2>
      <p>
        You can see every unit, file name and page count before you buy, so{' '}
        <Hl>all sales are final and there are no refunds</Hl>. If a payment goes through but the course
        doesn't appear on your shelf, write to us and we'll fix it.
      </p>
      <h2>Watermarks and misuse</h2>
      <p>
        Every reader page displays your registered name and college email, the note contributor's name, and a
        reminder that sharing is prohibited. If we find that notes have been shared, resold, or copied to get
        around these limits, <Hl>we may revoke access without a refund</Hl>, suspend the account, and restrict
        future purchases. Disputed or reversed payments remove access to that course.
      </p>
      <h2 id="contributors" className="scroll-mt-24">
        Sharing your notes (contributors)
      </h2>
      <p>When you upload notes, papers or other material on the Contribute page:</p>
      <ul className="steps">
        <li>
          You confirm it is your own work, or that you have the author's permission to share it, and that it
          isn't copied from a textbook, paid material or leaked exam papers, and contains no one's personal
          details.
        </li>
        <li>
          You keep the copyright. You allow {env.appName} to review it and, if we accept it, to tidy it up
          (cleaning scans, ordering pages), add watermarks, publish and sell it on {env.appName}. You can
          still use your notes anywhere else.
        </li>
        <li>
          Rewards are decided after review and shown on your Contribute page and in our email: a one-off
          payment for what we use, a free course, or, when your notes for a whole subject are sold as a
          course, a <Hl>royalty of 30%</Hl> (or the share we agree with you and show on your Contribute page)
          of what students paid for that course, after the payment provider's fee. A bundle counts the
          course's share of the bundle price. The royalty starts on the date shown and leaves out payments
          that are reversed or disputed. {PROMISE.royaltyLasts}
        </li>
        <li>
          {PROMISE.yearlyBonus} The year is the last 12 months before the bonus is awarded, and only royalties
          count towards it.
        </li>
        <li>
          Payments are made by UPI. Your Contribute page shows what you've earned, what we've paid and what is
          due. You're responsible for any tax on what you earn.
        </li>
        <li>
          We may decline any upload, and may take material off sale later. You can ask us to stop selling your
          notes; we'll remove them within a reasonable time and the royalty ends then. Students who already
          bought keep their access.
        </li>
        <li>
          If material turns out to be copied or shared without permission, we remove it, any reward for it is
          cancelled, and uploading is turned off for that account.
        </li>
      </ul>
      <h2>Questions and problem reports</h2>
      <p>
        Questions sent from the Help page, with any screenshots, are kept with your account so we can answer
        them. <Hl>Don't include passwords or payment card details.</Hl>
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
    <Legal title="Privacy" updated="22 NOV 2026">
      <p>We keep only what's needed to run your account and stop it being shared.</p>
      <h2>What we store</h2>
      <ul className="steps">
        <li>Your college email and the name you give us.</li>
        <li>
          Your devices: a label (like "Chrome on Windows"), a random device ID and when each was last used.
        </li>
        <li>
          Your purchases and the Razorpay order and payment IDs.{' '}
          <Hl>We never see or store card or UPI details.</Hl>
        </li>
        <li>
          Reading activity: which page you're on and how many pages you've viewed, to resume where you left
          off and limit scraping.
        </li>
        <li>
          Which pages and tools you open on the site, and a few actions (signing in, peeking inside a course,
          starting a checkout, paying, opening a file), counted per day. When you're signed in this is kept
          with your account so we can see what is useful and improve it; when you're not, you're counted
          together with every other visitor and nothing identifies you. <Hl>It's deleted after 180 days.</Hl>
        </li>
        <li>Your IP address and browser when you open files, used only for security.</li>
        <li>
          A one-way code made from your network address when a sign-in is refused. After 5 refused addresses
          in a day that network can't ask for sign-in links for 24 hours. The code is deleted after a day.
        </li>
        <li>
          Files you upload on the Contribute page and screenshots you attach on the Help page, stored
          privately and opened only by the {env.appName} team, with your questions and our answers.
        </li>
        <li>For contributors: royalties earned and payments we've made to you.</li>
      </ul>
      <h2>Who processes it</h2>
      <p>
        Supabase (accounts and database), Cloudflare (hosting, storage, bot protection), Razorpay (payments)
        and Google (if you sign in with Google).
      </p>
      <h2>Cookies</h2>
      <p>
        One signed device cookie and your sign-in session. <Hl>No advertising or tracking cookies.</Hl>
      </p>
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
    <Legal title="Contact" updated="24 OCT 2026">
      <p>
        Payment went through but the course isn't on your shelf? A file won't open? Found a mistake in the
        notes? The quickest way is the{' '}
        <Link to="/help" className="font-semibold text-teal-text">
          Help page
        </Link>
        : sign in, describe it, add a screenshot, and you'll get the answer by email.
      </p>
      <p>
        Not a student, or can't sign in? Write to <strong className="font-mono">{CONTACT_EMAIL}</strong>.
        Include the order ID from your Razorpay receipt for payment questions.{' '}
        <Hl>We usually reply within a day.</Hl>
      </p>

      <h2>Earn from your notes</h2>
      <p>
        Upload your notes, past papers or slides on the{' '}
        <Link to="/contribute" className="font-semibold text-teal-text">
          Contribute page
        </Link>
        . We pay for what we use, and if your notes for a whole subject become a course, you get 30% of every
        sale. See the{' '}
        <Link to="/terms#contributors" className="font-semibold text-teal-text">
          contributor terms
        </Link>
        .
      </p>
    </Legal>
  );
}
