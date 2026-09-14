import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '../..');
// Optional scratch dependency directory keeps generated dependencies out of the
// repository. A normal `npm install` in this directory also works.
const require = createRequire(process.env.PGLITE_PACKAGE_ROOT
  ? join(resolve(process.env.PGLITE_PACKAGE_ROOT), 'package.json')
  : import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const db = new PGlite({ extensions: { pgcrypto } });

let checks = 0;
const state = {};
const check = (name, fn) => async () => {
  try {
    await fn();
    checks += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
};

try {
  await db.exec(await readFile(join(here, 'bootstrap.sql'), 'utf8'));
  const migrationDir = join(project, 'supabase/migrations');
  const migrations = (await readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort();
  if (!migrations.length) throw new Error('No backend migration files found.');
  for (const name of migrations) {
    await db.exec(await readFile(join(migrationDir, name), 'utf8'));
    process.stdout.write(`APPLIED ${name}\n`);
  }
  if (!process.argv.includes('--migrations-only')) {
    const suites = (await readdir(here)).filter(name => name.endsWith('.test.mjs')).sort();
    if (!suites.length) throw new Error('No backend contract test suites found.');
    for (const name of suites) {
      const suite = await import(pathToFileURL(join(here, name)));
      await suite.default({ db, check, state });
    }
  }
  process.stdout.write(`Backend validation complete: ${migrations.length} migrations, ${checks} checks.\n`);
} catch (error) {
  process.stderr.write(`FAIL ${error.message}\n`);
  if (error.detail) process.stderr.write(`DETAIL ${error.detail}\n`);
  if (error.where) process.stderr.write(`CONTEXT ${error.where}\n`);
  if (error.query) process.stderr.write(`QUERY ${error.query.slice(0, 300)}\n`);
  process.exitCode = 1;
} finally {
  await db.close();
}
