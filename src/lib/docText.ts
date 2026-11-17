// Text from attached documents, in the window (0.11.0). The parsing is in docParse.ts (pure, tested
// in core/test/s23.test.ts); this file only gives pdf.js its worker, which ships with the app. The
// worker is bundled as a normal .js chunk (Vite's ?worker): a copied .mjs file could be served with a
// type the webview refuses to run as a module.
import { DocReadError, docKind, textFromDocument, READABLE, DOC_ACCEPT } from './docParse';

export { DocReadError, docKind, READABLE, DOC_ACCEPT };

let worker: Promise<void> | null = null;
const pdfWorker = () => (worker ??= (async () => {
  const [pdfjs, { default: PdfWorker }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'),
  ]);
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
})().catch((e) => { worker = null; throw e; }));

/** The text of an attached file, or null when Lotus can't read that kind (see docParse). */
export async function documentText(file: File): Promise<string | null> {
  if (docKind(file.name, file.type) === 'pdf') await pdfWorker();
  return textFromDocument(file.name, file.type, file);
}
