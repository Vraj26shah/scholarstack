/** "Chrome on Windows", "Safari on iPhone" — shown in the device list. */
export function deviceLabel(ua: string): string {
  // The Android apps say who they are in their user agent.
  const app = /ScholarsStackApp\/(student|partner)/.exec(ua)?.[1];
  if (app) return app === 'partner' ? 'Partner app · Android' : 'Scholars Stack app · Android';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'device';
  return `${browser} on ${os}`;
}
