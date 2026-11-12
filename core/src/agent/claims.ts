// "No step, no claim" (pure, tested). Finds sentences where the reply says Lotus did something
// (added a task, made an image, saved a file…) and checks that a step of the same kind succeeded
// in this run. Session 14's live test: asked to list files, make an image and add a task, a model
// said it had done all three and called nothing. This is the check that catches that.
//
// It is deliberately narrow: first person, past tense, no negation or offer in the sentence.
// English plus the commonest Portuguese forms (the user writes in both).

export type ClaimKind = 'task' | 'image' | 'file' | 'memory' | 'folder' | 'web';

export interface Claim { kind: ClaimKind; sentence: string }

/** Which tools back each kind of claim. */
export const CLAIM_TOOLS: Record<ClaimKind, string[]> = {
  task: ['task.add', 'task.move'],
  image: ['image.generate'],
  file: ['files.write'],
  memory: ['memory.save'],
  folder: ['files.list', 'files.read', 'files.search'],
  web: ['web.search', 'web.read'],
};

/** Checked only in the part of the sentence up to the claim: "No problem, I've added it" still counts. */
const NEGATION = /\b(not|never|unable|cannot|can't|can’t|couldn't|couldn’t|didn't|didn’t|won't|won’t|wasn't|haven't|haven’t|hasn't|would|could|should|shall|will|i'll|i’ll|want me|like me|do you want|try to|trying to|não|nao|posso|poderia|queres|quer que|vou)\b|n't\b/i;

const I_DID = String.raw`(?:i(?:'ve|’ve| have)?(?: just| now| also)?|eu)`;

const PATTERNS: { kind: ClaimKind; re: RegExp }[] = [
  { kind: 'task', re: new RegExp(String.raw`\b${I_DID}\s+(?:added|created|put|moved|scheduled|set up|made)\b[^.!\n]{0,80}\b(?:tasks?|to-?dos?|board|kanban|reminders?|backlog|review column)\b`, 'i') },
  { kind: 'task', re: /\b(?:tasks?|to-?dos?)\b[^.!\n]{0,40}\b(?:has been|have been|was|were|is now)\s+(?:added|created|moved)\b/i },
  { kind: 'task', re: /^(?:tasks?|to-?dos?|reminders?)\b[^.!\n]{0,10}\b(?:added|created)\b/i },
  { kind: 'task', re: /\b(?:adicionei|criei|movi)\b[^.!\n]{0,80}\b(?:tarefas?|quadro|lista)\b/i },
  { kind: 'image', re: new RegExp(String.raw`\b${I_DID}\s+(?:generated|created|made|drawn|drew|rendered|painted)\b[^.!\n]{0,80}\b(?:images?|pictures?|photos?|illustrations?|drawings?|artwork|wallpaper|logo)\b`, 'i') },
  { kind: 'image', re: /\bhere(?:'s| is| are)\s+(?:the|your|an?)\s+(?:generated\s+)?(?:images?|pictures?|illustrations?|drawings?)\b/i },
  { kind: 'image', re: /\b(?:gerei|criei|desenhei)\b[^.!\n]{0,80}\b(?:imagem|imagens|fotos?|ilustraç(?:ão|ões)|desenhos?)\b/i },
  { kind: 'file', re: new RegExp(String.raw`\b${I_DID}\s+(?:saved|written|wrote|created|updated|edited)\b[^.!\n]{0,80}\b(?:files?|documents?|notes?|\.(?:md|txt|json|csv|py|ts|js|html))\b`, 'i') },
  { kind: 'file', re: /\b(?:guardei|salvei|escrevi)\b[^.!\n]{0,80}\b(?:ficheiros?|arquivos?|documentos?|notas?)\b/i },
  { kind: 'memory', re: new RegExp(String.raw`\b${I_DID}\s+(?:saved|stored|noted|added|remembered)\b[^.!\n]{0,60}\b(?:memory|memories|remember)\b`, 'i') },
  { kind: 'folder', re: new RegExp(String.raw`\b${I_DID}\s+(?:listed|looked (?:at|through|in)|checked|scanned|read|opened|searched)\b[^.!\n]{0,60}\b(?:folders?|directory|directories|files?)\b`, 'i') },
  { kind: 'folder', re: /\b(?:your|the|this) (?:folder|directory) (?:contains|has|holds)\b/i },
  { kind: 'web', re: new RegExp(String.raw`\b${I_DID}\s+(?:searched|looked up|browsed|checked)\b[^.!\n]{0,40}\b(?:web|internet|online|google|duckduckgo)\b`, 'i') },
];

/** Splits text into sentences, ignoring code blocks and quotes of what the user said. */
export function sentences(text: string): string[] {
  const clean = String(text ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' x ').replace(/^>.*$/gm, ' ');
  return clean.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

export function findClaims(text: string): Claim[] {
  const out: Claim[] = [];
  for (const s of sentences(text)) {
    if (/\?\s*$/.test(s)) continue; // a question, not a claim
    for (const p of PATTERNS) {
      const m = p.re.exec(s);
      if (!m || out.some((c) => c.kind === p.kind)) continue;
      if (NEGATION.test(s.slice(0, m.index + m[0].length))) continue;
      // "I created board.md, which lists the tasks on your board" is about a file, not a task.
      if (p.kind === 'task' && /\bfiles?\b|\.(?:md|txt|json|csv)\b/i.test(s)) continue;
      out.push({ kind: p.kind, sentence: s.slice(0, 200) });
    }
  }
  return out;
}

/** Claims with no successful step of their kind in this run. */
export function unbackedClaims(text: string, succeededTools: string[]): Claim[] {
  const done = new Set(succeededTools);
  return findClaims(text).filter((c) => !CLAIM_TOOLS[c.kind].some((t) => done.has(t)));
}

const WHAT: Record<ClaimKind, string> = {
  task: 'add or move a task', image: 'make an image', file: 'save a file', memory: 'save a memory', folder: 'look at your files', web: 'search the web',
};
export const claimText = (c: Claim) => WHAT[c.kind];
