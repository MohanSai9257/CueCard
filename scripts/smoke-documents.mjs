import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fixtures = require('../tests/document-fixtures.cjs');
const executable = process.argv[2];
if (!executable) throw new Error('Pass the packaged executable.');
const profile = await mkdtemp(join(tmpdir(), 'cuecard-documents-'));
const child = spawn(executable, ['--inspect=9330', `--user-data-dir=${profile}`], { stdio: 'ignore' });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  let pages;
  for (let i = 0; i < 80; i++) {
    try {
      pages = await (await fetch('http://127.0.0.1:9330/json/list')).json();
    } catch {}
    if (pages?.[0]) break;
    await pause(100);
  }
  if (!pages?.[0]) throw new Error('Main-process debugger was unavailable.');
  socket = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let sequence = 0;
  async function evaluate(expression) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Document smoke test timed out.')), 30000);
      socket.onmessage = ({ data }) => {
        const response = JSON.parse(data);
        if (response.id !== id) return;
        clearTimeout(timer);
        if (response.error || response.result?.exceptionDetails)
          reject(new Error(JSON.stringify(response.error || response.result.exceptionDetails)));
        else resolve(response.result.result.value);
      };
      socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      );
    });
  }
  const parser = resolve(executable, '../../Resources/app.asar/resume-parser.js');
  for (const extension of ['pdf', 'docx']) {
    const file = join(profile, `resume.${extension}`);
    await writeFile(file, fixtures[extension]());
    const result = await evaluate(
      `process.mainModule.require(${JSON.stringify(parser)}).parseResume(${JSON.stringify(file)})`,
    );
    if (!result?.text?.includes('Test Candidate Backend Engineer'))
      throw new Error(`Packaged ${extension} reader failed.`);
    console.log(JSON.stringify({ document: extension, passed: true }));
  }
} finally {
  socket?.close();
  child.kill('SIGTERM');
}
