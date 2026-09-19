import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(process.execPath, [
  '--experimental-transform-types', '--test',
  fileURLToPath(new URL('./edge.test.mjs', import.meta.url)),
  fileURLToPath(new URL('./website-analytics.test.mjs', import.meta.url)),
  fileURLToPath(new URL('./newsletter.test.mjs', import.meta.url)),
  fileURLToPath(new URL('./newsletter-welcome.test.mjs', import.meta.url)),
], { stdio: 'inherit' });
if (result.error) {
  console.error(`Unable to run Edge tests: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

