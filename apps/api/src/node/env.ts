import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Reads the project's root .env (same rules as scripts/env-lib.mjs). Never prints values. */
export function loadEnv(path = resolve(import.meta.dirname, '../../../../.env')): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`No .env at ${path}. Copy .env.example to .env and fill it in (see SETUP.md).`);
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    out[key] = value;
  }
  return { ...out, ...pickProcessEnv(Object.keys(out)) };
}

/** Values exported in the shell win over the file (handy for one-off overrides). */
function pickProcessEnv(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (process.env[k]) out[k] = process.env[k]!;
  return out;
}

export const isPlaceholder = (v: string | undefined): boolean =>
  !v || /^(your|change|xxx|todo|replace)/i.test(v) || /YOUR[-_ ]/i.test(v) || v === 'you@vitbhopal.ac.in';
