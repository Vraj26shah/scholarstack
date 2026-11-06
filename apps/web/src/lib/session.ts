import type { DeviceDto, MeDto } from '@ss/contracts';
import { create } from 'zustand';
import { ApiError, api } from './api';
import { authGateway } from './auth';
import { deviceLabel } from './device-label';

export type SessionStatus = 'loading' | 'unavailable' | 'signed-out' | 'ready' | 'replaced' | 'device-limit';

export type SessionReplacementReason = 'newer-sign-in' | 'device-check' | null;

interface SessionState {
  status: SessionStatus;
  me: MeDto | null;
  blockingDevices: DeviceDto[];
  replacedReason: SessionReplacementReason;
  bootstrap(): Promise<void>;
  /** After an explicit sign-in (or "sign in again here"): claim this device. */
  claim(): Promise<void>;
  setMe(me: MeDto): void;
  signOut(): Promise<void>;
  handleProblem(error: ApiError): void;
}

let claimInFlight: Promise<void> | null = null;

/**
 * Which sign-in this browser has already registered as a device. Lets the first page load after
 * a sign-in register the device straight away, instead of asking "who am I?" first and getting
 * a 409 back (which browsers print in red in the console). Only ever skips a request: the
 * server still decides, and still refuses a copied session.
 */
const CLAIMED_KEY = 'ss_claimed_session';
function sessionIdOf(token: string): string {
  try {
    const part = token.split('.')[1] ?? '';
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { session_id?: string };
    return json.session_id ?? token.slice(-24);
  } catch {
    return token.slice(-24);
  }
}
function claimedFor(token: string): boolean {
  try {
    return localStorage.getItem(CLAIMED_KEY) === sessionIdOf(token);
  } catch {
    return true; // storage unavailable: keep the old behaviour
  }
}
async function rememberClaim() {
  try {
    const token = await authGateway.token();
    if (token) localStorage.setItem(CLAIMED_KEY, sessionIdOf(token));
  } catch {
    // best effort
  }
}
let bootstrapInFlight: Promise<void> | null = null;

type Set = (s: Partial<SessionState>) => void;

async function claimDevice(set: Set): Promise<void> {
  try {
    await api.claim(deviceLabel());
    await rememberClaim();
    // Verify the browser accepted the HttpOnly device cookie before treating sign-in as complete.
    const me = await api.me();
    set({ status: 'ready', me, blockingDevices: [], replacedReason: null });
  } catch (e) {
    if (e instanceof ApiError && e.code === 'DEVICE_LIMIT') {
      return set({ status: 'device-limit', blockingDevices: (e.details as DeviceDto[]) ?? [] });
    }
    throw e;
  }
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  me: null,
  blockingDevices: [],
  replacedReason: null,

  bootstrap() {
    if (bootstrapInFlight) return bootstrapInFlight;
    bootstrapInFlight = (async () => {
      try {
        const token = await authGateway.token();
        if (!token) return set({ status: 'signed-out', me: null, replacedReason: null });
        // First load with this sign-in in this browser: register the device right away.
        if (!claimedFor(token)) return await get().claim();
        set({ status: 'ready', me: await api.me(), replacedReason: null });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'SESSION_REPLACED') return; // handled by the listener
        if (e instanceof ApiError && e.status === 401) {
          await authGateway.signOut();
          return set({ status: 'signed-out', me: null, replacedReason: null });
        }
        // Keep the auth identity intact on network/API errors; offer a retry instead of
        // incorrectly presenting the visitor as signed out.
        set({ status: 'unavailable' });
      }
    })().finally(() => {
      bootstrapInFlight = null;
    });
    return bootstrapInFlight;
  },

  claim() {
    // Single flight: concurrent callers share one claim (see ApiClient.useClaimer).
    claimInFlight ??= claimDevice(set).finally(() => {
      claimInFlight = null;
    });
    return claimInFlight;
  },

  setMe(me) {
    set({ me });
  },

  async signOut() {
    try {
      localStorage.removeItem(CLAIMED_KEY);
    } catch {
      // ignore
    }
    await authGateway.signOut();
    set({ status: 'signed-out', me: null, replacedReason: null });
  },

  handleProblem(error) {
    if (error.code === 'SESSION_REPLACED' && get().status !== 'replaced') {
      const reason = (error.details as { reason?: SessionReplacementReason } | undefined)?.reason;
      set({
        status: 'replaced',
        replacedReason: reason === 'device-check' ? 'device-check' : 'newer-sign-in',
      });
    }
  },
}));

api.onSessionProblem((e) => useSession.getState().handleProblem(e));
api.useClaimer(() => useSession.getState().claim());
