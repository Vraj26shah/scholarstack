import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { isNativeApp } from '../../lib/app-mode';
import { signInPath } from '../../lib/return-to';
import { useSession } from '../../lib/session';
import { useTheme } from '../../lib/theme';
import { Page } from '../../shared/ui/chrome';
import {
  AskBubble,
  Bowl,
  Cross,
  Devices,
  DownloadIcon,
  Lock,
  Mail,
  Moon,
  ShelfIcon,
  Sun,
  Toolbox,
  Upload,
  User,
} from '../../shared/ui/icons';
import { AppHero, AppScreen, Row, RowGroup, card } from './app-ui';

/** /app/me: you, your orders and notes, settings, help. */
export default function MePage() {
  const { status, me, signOut } = useSession();
  const { theme, toggle } = useTheme();
  const owned = useQuery({
    queryKey: ['owned-messes', me?.id ?? ''],
    queryFn: api.ownedMesses,
    enabled: status === 'ready' && !!me && !me.isAdmin,
  });
  const runsRestaurant = (owned.data?.length ?? 0) > 0;
  const first = me?.fullName || me?.email.split('@')[0]?.split(/[._\d]/)[0] || '';
  const name = first ? first.charAt(0).toUpperCase() + first.slice(1) : '';

  return (
    <Page>
      <AppScreen>
        {status === 'ready' && me ? (
          <section className={`${card} mt-5 p-4 flex items-center gap-4`}>
            <span className="size-14 flex-none rounded-full grid place-items-center bg-brand text-white font-display text-[24px] font-bold">
              {(name || 'Y').slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[22px] font-bold leading-tight tracking-[-0.02em] truncate">
                {name || 'You'}
              </span>
              <span className="block text-[13.5px] text-ink2 truncate">{me.email}</span>
            </span>
          </section>
        ) : (
          <AppHero
            eyebrow="Scholars Stack"
            title="Sign in"
            sub="Use your college email: your notes, orders and reminders on every device."
          >
            <Link
              to={signInPath('/app/me')}
              className="inline-flex items-center h-11 px-5 rounded-full bg-brand text-white text-[15px] font-bold no-underline"
            >
              Sign in
            </Link>
          </AppHero>
        )}

        <RowGroup title="Yours">
          <Row
            to="/my-orders"
            icon={<Bowl size={21} />}
            title="Food orders"
            hint="Track, chat, order again"
          />
          <Row to="/shelf" icon={<ShelfIcon size={21} />} title="My shelf" hint="Notes you own" />
          <Row
            to="/contribute"
            icon={<Upload size={21} />}
            title="Contribute & earn"
            hint="Upload notes, see earnings"
          />
          {runsRestaurant && (
            <Row
              to="/partner"
              icon={<Toolbox size={21} />}
              title="My restaurant"
              hint="Orders, menu and sales"
            />
          )}
          {me?.isAdmin && <Row to="/admin" icon={<Lock size={21} />} title="Admin" />}
        </RowGroup>

        <RowGroup title="Settings">
          <Row
            onClick={toggle}
            icon={theme === 'dark' ? <Moon size={21} /> : <Sun size={21} />}
            title="Dark mode"
            end={
              <span
                aria-hidden="true"
                className={`relative h-[30px] w-[50px] flex-none rounded-full transition-colors ${theme === 'dark' ? 'bg-teal' : 'bg-line'}`}
              >
                <span
                  className={`absolute top-[3px] size-6 rounded-full bg-white shadow-sm transition-[left] ${theme === 'dark' ? 'left-[23px]' : 'left-[3px]'}`}
                />
              </span>
            }
          />
          {status === 'ready' && (
            <>
              <Row to="/account" icon={<Devices size={21} />} title="Devices" hint="Where you’re signed in" />
              <Row to="/account#emails" icon={<Mail size={21} />} title="Email updates" />
            </>
          )}
        </RowGroup>

        {!isNativeApp() && (
          <RowGroup>
            <Row
              to="/get-app"
              icon={<DownloadIcon size={21} />}
              title="Get the Android app"
              hint="Reminders that ring even when closed"
            />
          </RowGroup>
        )}

        <RowGroup title="Help">
          <Row to="/help" icon={<AskBubble size={21} />} title="Help & suggestions" />
          <Row to="/contact" icon={<User size={21} />} title="Contact us" />
          <Row to="/terms" icon={<ShelfIcon size={21} />} title="Terms" />
          <Row to="/privacy" icon={<Lock size={21} />} title="Privacy" />
        </RowGroup>

        {status === 'ready' && (
          <RowGroup>
            <Row
              onClick={() => {
                if (window.confirm('Sign out of Scholars Stack on this phone?')) void signOut();
              }}
              icon={<Cross size={21} />}
              title="Sign out"
              danger
            />
          </RowGroup>
        )}
        <p className="m-0 px-1 text-center text-[12px] text-ink2">
          Scholars Stack · an independent student project, not affiliated with VIT Bhopal University.
        </p>
      </AppScreen>
    </Page>
  );
}
