import { Link } from 'react-router-dom';
import { isNativeApp } from '../../lib/app-mode';
import { APP_RELEASE } from '../../lib/app-release';
import { BackLink } from '../../shared/ui/back-link';
import { Page } from '../../shared/ui/chrome';
import { Bell, Bowl, DownloadIcon, Lock, Phone } from '../../shared/ui/icons';
import { U } from '../../shared/ui/note';
import { PageHeader } from '../../shared/ui/page-title';

const WHY = [
  {
    icon: <Bell size={20} />,
    title: 'Reminders that ring',
    text: 'Class and meal reminders arrive even when the app is closed.',
  },
  {
    icon: <Bowl size={20} />,
    title: 'Food, live',
    text: 'Order, chat with the restaurant and see your order move.',
  },
  {
    icon: <Lock size={20} />,
    title: 'Your notes, kept safe',
    text: 'Everything on your shelf, one tap away.',
  },
  {
    icon: <Phone size={20} />,
    title: 'Tiny',
    text: `${APP_RELEASE.size}. Runs smoothly on any Android phone.`,
  },
];

const STEPS = [
  'Tap Download. Your phone saves ScholarsStack.apk.',
  'Open it from the notification or the Downloads folder.',
  'If asked, allow "Install unknown apps" for your browser, then tap Install.',
  'Open Scholars Stack and sign in with your college email.',
];

/** /get-app: how students (and restaurant owners) get the Android apps. */
export default function GetAppPage() {
  const inApp = isNativeApp();
  return (
    <Page>
      <PageHeader
        back={<BackLink fallback="/" />}
        eyebrow="Android app"
        title="Scholars Stack in your pocket."
        lead={
          <>
            Everything on the site, <U>made for your phone.</U> Free, no ads.
          </>
        }
      />

      <div className="max-w-[720px] flex flex-col gap-10">
        {inApp ? (
          <p className="m-0 text-[16px] font-semibold text-teal-text">✓ You're already using the app.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <a
              href={APP_RELEASE.student}
              download
              className="self-start inline-flex items-center gap-2.5 h-14 px-7 rounded-full bg-brand text-white text-[17px] font-bold no-underline press"
            >
              <DownloadIcon size={20} />
              Download for Android
            </a>
            <span className="text-[13.5px] text-ink2 tabular-nums">
              Version {APP_RELEASE.version} · {APP_RELEASE.size} · Android 7 and newer
            </span>
          </div>
        )}

        <ul className="m-0 p-0 list-none grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
          {WHY.map((w) => (
            <li key={w.title} className="flex gap-3.5">
              <span className="grid place-items-center size-10 flex-none rounded-full bg-mist/50 text-on-mist">
                {w.icon}
              </span>
              <span>
                <span className="block text-[16px] font-bold text-ink">{w.title}</span>
                <span className="block text-[14px] leading-relaxed text-ink2">{w.text}</span>
              </span>
            </li>
          ))}
        </ul>

        {!inApp && (
          <section className="flex flex-col gap-3">
            <h2 className="m-0 text-[19px] font-extrabold tracking-[-0.01em]">Installing it</h2>
            <ol className="m-0 pl-5 flex flex-col gap-2 text-[15px] leading-relaxed text-ink2 marker:font-bold marker:text-ink">
              {STEPS.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="m-0 text-[13.5px] text-ink2">
              Android shows that warning for every app from outside the Play Store. This one comes straight
              from this site. iPhone? Keep using the site: on a phone it already works like the app.
            </p>
          </section>
        )}

        <section className="flex flex-col gap-2 pt-6 border-t border-line">
          <h2 className="m-0 text-[17px] font-extrabold">Run a restaurant or mess?</h2>
          <p className="m-0 text-[14.5px] leading-relaxed text-ink2">
            SS Partner, in Hindi and English: a loud ring for every order, menu, tiffin and sales. Sign in
            with the mobile number and PIN we give you.{' '}
            <Link to="/contact" className="text-ink underline underline-offset-2">
              Ask us for one
            </Link>
            .
          </p>
          {!inApp && (
            <a
              href={APP_RELEASE.partner}
              download
              className="self-start text-[14.5px] font-bold text-teal-text no-underline"
            >
              Download SS Partner ({APP_RELEASE.size}) →
            </a>
          )}
        </section>
      </div>
    </Page>
  );
}
