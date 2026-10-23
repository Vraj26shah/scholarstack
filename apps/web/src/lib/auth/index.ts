import { api } from '../api';
import { isDemo } from '../env';
import { DemoAuthGateway } from './demo-gateway';
import type { AuthGateway } from './gateway';
import { SupabaseAuthGateway } from './supabase-gateway';

/** Composition root for the browser: pick the auth adapter once. */
export const authGateway: AuthGateway = isDemo ? new DemoAuthGateway(api) : new SupabaseAuthGateway();

api.useTokens(() => authGateway.token());

export type { AuthGateway } from './gateway';
