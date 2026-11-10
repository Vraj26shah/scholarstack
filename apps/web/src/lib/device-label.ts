import { deviceLabel as labelFor } from '@ss/contracts';

/** "Chrome on Windows", "Safari on iPhone" — shown in the device list. */
export const deviceLabel = (ua: string = navigator.userAgent) => labelFor(ua);
