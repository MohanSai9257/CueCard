import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function check(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'release', '.git', 'assets'].includes(entry.name)) continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else if (/\.(js|mjs|cjs)$/.test(file))
      execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  }
}
check('.');
