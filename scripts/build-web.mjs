import { mkdir, copyFile, rm } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await rm(new URL('dist', root), { recursive: true, force: true });
await mkdir(new URL('dist', root), { recursive: true });
for (const name of ['index.html', 'site.css']) await copyFile(new URL(`website/${name}`, root), new URL(`dist/${name}`, root));
await copyFile(new URL('assets/icon.svg', root), new URL('dist/icon.svg', root));
