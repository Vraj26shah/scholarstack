import { useCallback, useEffect, useState } from 'react';
import { phoneSetup } from '../../lib/native-push';
import { card } from '../student-app/app-ui';
import { useT } from './i18n';

/**
 * In the Partner app (Android only): the phone settings that decide whether the order ring gets
 * through. Each line shows ✓ or a button that opens the right settings screen.
 */
export function PhoneSetup() {
  const { t } = useT();
  const plugin = phoneSetup();
  const [s, setS] = useState<{ ignoringBattery: boolean; notifications: boolean; maker: string } | null>(
    null,
  );
  const refresh = useCallback(() => {
    void plugin
      ?.status()
      .then(setS)
      .catch(() => {});
  }, [plugin]);
  useEffect(() => {
    refresh();
    // Back from the settings screen: check again.
    const on = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [refresh]);
  if (!plugin || !s) return null;
  const rows: { ok: boolean; title: string; hint: string; action: string; run: () => void }[] = [
    {
      ok: s.notifications,
      title: t('setupNotifications'),
      hint: t('setupNotificationsHint'),
      action: t('setupOpen'),
      run: () => void plugin.openNotificationSettings(),
    },
    {
      ok: s.ignoringBattery,
      title: t('setupBattery'),
      hint: t('setupBatteryHint'),
      action: t('setupAllow'),
      run: () => void plugin.askIgnoreBattery(),
    },
  ];
  const makerNeedsAutostart =
    /xiaomi|redmi|poco|vivo|iqoo|oppo|realme|oneplus|huawei|honor|asus|letv|samsung/.test(s.maker);
  return (
    <section className={`${card} p-4 flex flex-col gap-3`}>
      <h3 className="m-0 text-[17px] font-extrabold">{t('setupTitle')}</h3>
      <p className="m-0 text-[14px] leading-relaxed text-ink2">{t('setupLead')}</p>
      <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
        {rows.map((r) => (
          <li key={r.title} className="flex items-center gap-3 rounded-2xl bg-sunk px-3.5 py-3">
            <span
              className={`grid place-items-center size-8 flex-none rounded-full text-[15px] font-bold ${r.ok ? 'bg-[#1f8a4c] text-white' : 'bg-marigold-soft text-marigold-text'}`}
              aria-hidden="true"
            >
              {r.ok ? '✓' : '!'}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[15.5px] font-bold">{r.title}</span>
              <span className="block text-[13px] text-ink2">{r.hint}</span>
            </span>
            {!r.ok && (
              <button
                type="button"
                onClick={r.run}
                className="flex-none h-10 px-4 rounded-xl bg-brand text-white text-[14px] font-bold"
              >
                {r.action}
              </button>
            )}
          </li>
        ))}
        {makerNeedsAutostart && (
          <li className="flex items-center gap-3 rounded-2xl bg-sunk px-3.5 py-3">
            <span
              className="grid place-items-center size-8 flex-none rounded-full bg-mist/60 text-on-mist text-[15px] font-bold"
              aria-hidden="true"
            >
              ↻
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[15.5px] font-bold">{t('setupAutostart')}</span>
              <span className="block text-[13px] text-ink2">{t('setupAutostartHint')}</span>
            </span>
            <button
              type="button"
              onClick={() => void plugin.openAutostart()}
              className="flex-none h-10 px-4 rounded-xl bg-brand text-white text-[14px] font-bold"
            >
              {t('setupOpen')}
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}
