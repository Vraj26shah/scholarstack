/**
 * What to do when a blocker stops a part of the site (the payment window, the security check).
 * Plain steps for the common setups; nothing technical.
 */
export function BlockerHelp({ what = 'payments' }: { what?: 'payments' | 'sign-in' }) {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'this site';
  return (
    <div className="flex flex-col gap-2 text-[14px] leading-relaxed text-ink2">
      <p className="m-0 font-semibold text-ink">To fix it, try one of these, then press Try again:</p>
      <ul className="m-0 pl-5 flex flex-col gap-1">
        <li>
          Turn off your ad blocker for <span className="font-semibold text-ink break-all">{host}</span>{' '}
          (uBlock, AdBlock, AdGuard: click its icon, then “pause” or “allow on this site”).
        </li>
        <li>In Brave, tap the lion icon and turn Shields off for this site.</li>
        <li>On a phone, open the link in Chrome or Safari, not inside WhatsApp or Instagram.</li>
        {what === 'payments' && (
          <li>Turn off a VPN or private DNS that blocks “trackers”, just while you pay.</li>
        )}
      </ul>
    </div>
  );
}
