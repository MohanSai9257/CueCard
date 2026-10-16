const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');

function checkDocxSize(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > buffer.length) throw new Error('This Word document is not a valid DOCX file.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  let total = 0;
  if (count > 5000) throw new Error('This Word document contains too many embedded files.');
  for (let index = 0; index < count; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('This Word document is damaged.');
    const size = buffer.readUInt32LE(offset + 24);
    total += size;
    if (size > 20 * 1024 * 1024 || total > 40 * 1024 * 1024)
      throw new Error('This Word document is too large after decompression.');
    offset +=
      46 +
      buffer.readUInt16LE(offset + 28) +
      buffer.readUInt16LE(offset + 30) +
      buffer.readUInt16LE(offset + 32);
  }
}

if (isMainThread) {
  function parseResume(fileName, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: fileName,
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      });
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error('This résumé took too long to read. Try a smaller, text-searchable PDF or DOCX.'));
      }, timeoutMs);
      const done = (callback) => (value) => {
        clearTimeout(timer);
        callback(value);
      };
      worker.once(
        'message',
        done((result) => {
          if (result.error) reject(new Error(result.error));
          else resolve(result);
        }),
      );
      worker.once(
        'error',
        done(() => reject(new Error('The résumé could not be read safely. Try a smaller PDF or DOCX.'))),
      );
      worker.once(
        'exit',
        done((code) => {
          if (code !== 0) reject(new Error('The résumé reader stopped. Try a smaller PDF or DOCX.'));
        }),
      );
    });
  }
  module.exports = { parseResume, checkDocxSize };
} else {
  (async () => {
    try {
      const fileName = workerData;
      if ((await fs.stat(fileName)).size > 15 * 1024 * 1024)
        throw new Error('Résumé files must be smaller than 15 MB.');
      const buffer = await fs.readFile(fileName);
      const extension = path.extname(fileName).toLowerCase();
      let text;
      if (extension === '.pdf' && buffer.subarray(0, 5).toString() === '%PDF-') {
        const { PDFParse } = require('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false });
        try {
          text = (await parser.getText()).text;
        } finally {
          await parser.destroy();
        }
      } else if (extension === '.docx') {
        checkDocxSize(buffer);
        text = (await require('mammoth').extractRawText({ buffer })).value;
      } else throw new Error('Please select a valid PDF or DOCX résumé.');
      text = text.split(String.fromCharCode(0)).join('').trim().slice(0, 100000);
      if (!text) throw new Error('No readable text was found. Use a text-searchable PDF or DOCX.');
      parentPort.postMessage({ name: path.basename(fileName), text });
    } catch (error) {
      parentPort.postMessage({ error: error.message });
    }
  })();
}
