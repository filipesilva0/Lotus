// A stand-in for sherpa-onnx-offline-tts (writes a short WAV) and sherpa-onnx-offline (prints a result).
import { writeFileSync } from 'node:fs';
const a = process.argv.slice(2);
const mode = process.env.FAKE_MODE;
if (process.env.FAKE_LOG) writeFileSync(process.env.FAKE_LOG, JSON.stringify(a));
if (mode === 'tts') {
  const out = a.find((x) => x.startsWith('--output-filename='))!.split('=')[1];
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(0, 40);
  writeFileSync(out, h);
  console.error('Elapsed seconds: 0.1');
} else {
  console.error('Creating recognizer ...');
  console.log(a[a.length - 1]);
  console.log('{"lang": "", "emotion": "", "event": "", "text": " Olá, mundo", "timestamps": [], "tokens": []}');
  console.error('num threads: 4');
}
