/**
 * Applies supabase/migrations/*.sql in order, each in its own transaction, and records them in
 * supabase_migrations.schema_migrations: the same table the Supabase CLI uses, so
 * `supabase db push` later sees them as already applied.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../../../supabase/migrations');

export interface Migration {
  version: string;
  name: string;
  sql: string;
}

export function readMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({
      version: f.slice(0, 14),
      name: f.slice(15, -4),
      sql: readFileSync(join(dir, f), 'utf8'),
    }));
}

const LEDGER = `
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);`;

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** One migration as a transaction that also records itself in the ledger. */
export function wrap(m: Migration): string {
  return `begin;\n${m.sql}\n;\ninsert into supabase_migrations.schema_migrations (version, name) values (${quote(m.version)}, ${quote(m.name)}) on conflict do nothing;\ncommit;\n`;
}

export interface SqlRunner {
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
}

export async function appliedVersions(db: SqlRunner): Promise<Set<string>> {
  await db.query(LEDGER);
  const rows = await db.query<{ version: string }>(
    'select version from supabase_migrations.schema_migrations',
  );
  return new Set(rows.map((r) => r.version));
}

export async function applyPending(
  db: SqlRunner,
  log: (line: string) => void = console.log,
): Promise<{ applied: string[]; skipped: string[] }> {
  const done = await appliedVersions(db);
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const m of readMigrations()) {
    if (done.has(m.version)) {
      skipped.push(m.version);
      continue;
    }
    log(`→ ${m.version}_${m.name}`);
    await db.query(wrap(m));
    applied.push(m.version);
  }
  return { applied, skipped };
}

/**
 * One file with every migration, for pasting into Supabase → SQL Editor. Each migration is
 * skipped automatically if it was already applied, so pasting it twice is safe.
 */
export function bundleSql(out: string): string {
  const parts = [
    '-- Scholars Stack: full database setup. Paste into Supabase → SQL Editor → Run.',
    '-- Safe to run again: migrations already applied are skipped.',
    LEDGER,
  ];
  for (const m of readMigrations()) {
    parts.push(
      `\n-- ═══ ${m.version}_${m.name} ═══`,
      `do $migration$ begin\n  if exists (select 1 from supabase_migrations.schema_migrations where version = ${quote(m.version)}) then\n    raise notice 'skip ${m.version}';\n    return;\n  end if;\n  execute ${dollar(m.sql)};\n  insert into supabase_migrations.schema_migrations (version, name) values (${quote(m.version)}, ${quote(m.name)});\nend $migration$;`,
    );
  }
  writeFileSync(out, `${parts.join('\n')}\n`);
  return out;
}

/** Dollar-quotes SQL with a tag that cannot occur inside it. */
function dollar(sql: string): string {
  let tag = 'm';
  while (sql.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${sql}$${tag}$`;
}
