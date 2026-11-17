// "No step, no claim" (pure, tested). Finds sentences where the reply says Lotus did something
// (added a task, made an image, saved a file…) and checks that a step of the same kind succeeded
// in this run. Session 14's live test: asked to list files, make an image and add a task, a model
// said it had done all three and called nothing. This is the check that catches that.
//
// It is deliberately narrow: first person, past tense, no negation or offer in the sentence.
// English plus the commonest Portuguese forms (the user writes in both).

export type ClaimKind = 'task' | 'image' | 'file' | 'memory' | 'folder' | 'web' | 'schedule' | 'delete' | 'install';

/** `count`: how many the sentence says ("added 4 tasks" → 4); absent when it names no number. */
export interface Claim { kind: ClaimKind; sentence: string; count?: number }

/** Which tools back each kind of claim. */
export const CLAIM_TOOLS: Record<ClaimKind, string[]> = {
  task: ['task.add', 'task.move', 'todo.create', 'routine.add'],
  image: ['image.generate'],
  file: ['files.write', 'files.edit'],
  memory: ['memory.save', 'soul.update'],
  folder: ['files.list', 'files.read', 'files.search'],
  web: ['web.search', 'web.read'],
  schedule: ['routine.add'],
  // Routines can be deleted, and files.edit can remove part of a file; "I deleted the file" or "the task" never is (no tool does it).
  delete: ['routine.remove', 'files.edit'],
  // Installs need the user's click on an install card, so a model can never say it installed something.
  install: [],
};

/** Checked only in the part of the sentence up to the claim: "No problem, I've added it" still counts. */
const NEGATION = /\b(not|never|unable|cannot|can't|can’t|couldn't|couldn’t|didn't|didn’t|won't|won’t|wasn't|haven't|haven’t|hasn't|would|could|should|shall|will|i'll|i’ll|want me|like me|do you want|try to|trying to|não|nao|posso|poderia|queres|quer que|vou)\b|n't\b/i;

const I_DID = String.raw`(?:i(?:'ve|’ve| have)?(?: just| now| also)?|eu)`;

const PATTERNS: { kind: ClaimKind; re: RegExp }[] = [
  { kind: 'task', re: new RegExp(String.raw`\b${I_DID}\s+(?:added|created|put|moved|scheduled|set up|made)\b[^.!\n]{0,80}\b(?:tasks?|to-?dos?|board|kanban|reminders?|backlog|review column|routines?|cron(?: jobs?)?|schedules?)\b`, 'i') },
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
  { kind: 'schedule', re: new RegExp(String.raw`\b${I_DID}\s+(?:scheduled|set up|created|added)\b[^.!\n]{0,80}\b(?:routines?|cron(?: jobs?)?|schedules?|(?:daily|weekly|hourly|monthly|recurring) (?:reminders?|jobs?|checks?))\b`, 'i') },
  { kind: 'schedule', re: new RegExp(String.raw`\b${I_DID}\s+scheduled\b`, 'i') },
  { kind: 'schedule', re: /\b(?:agendei|programei)\b/i },
  { kind: 'delete', re: new RegExp(String.raw`\b${I_DID}\s+(?:deleted|removed|erased|cleared|wiped|uninstalled)\b`, 'i') },
  { kind: 'delete', re: /\b(?:apaguei|eliminei|removi|exclu[ií])\b/i },
  { kind: 'delete', re: /\b(?:has been|have been|was|were)\s+(?:deleted|removed|erased)\b/i },
  { kind: 'install', re: new RegExp(String.raw`\b${I_DID}\s+(?:installed|downloaded|set up|pulled)\b[^.!\n]{0,60}\b(?:models?|engines?|ollama|comfyui|voicebox|llama\.cpp|apps?|programs?|packages?|plugins?|extensions?)\b`, 'i') },
  { kind: 'install', re: /\b(?:instalei|descarreguei|transferi)\b/i },
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
      const count = countIn(s);
      out.push({ kind: p.kind, sentence: s.slice(0, 200), ...(count ? { count } : {}) });
    }
  }
  return out;
}

const NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20,
  um: 1, uma: 1, dois: 2, duas: 2, 'três': 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};
const NOUNS = String.raw`(?:tasks?|to-?dos?|items?|reminders?|images?|pictures?|photos?|illustrations?|files?|documents?|notes?|memories|routines?|cron jobs?|schedules?|tarefas?|itens|imagens?|fotos?|ficheiros?|arquivos?|notas?|mem[oó]rias?|rotinas?)`;
const COUNT_RE = new RegExp(String.raw`\b(\d{1,3}|${Object.keys(NUM).join('|')})\s+(?:(?:new|more|separate|different|novas?|novos?|separad[oa]s)\s+)?${NOUNS}\b`, 'i');

/** "I added 4 tasks" → 4; "I added the task" → undefined. Only counts above one matter. */
export function countIn(sentence: string): number | undefined {
  const m = COUNT_RE.exec(sentence);
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1].toLowerCase()];
  return n && n > 1 ? n : undefined;
}

/** A successful step, as far as counting goes. */
export interface DoneStep { tool: string; args?: Record<string, unknown>; media?: string[]; data?: Record<string, unknown> }

/** How many things one successful step made: a to-do list's items, an image batch's pictures, else 1. */
export function unitsOf(s: DoneStep): number {
  if (s.tool === 'todo.create') {
    const ids = Array.isArray(s.data?.taskIds) ? s.data!.taskIds.length : 0;
    const items = Array.isArray(s.args?.items) ? s.args!.items.length : 0;
    return Math.max(1, ids, items);
  }
  if (s.tool === 'image.generate') return Math.max(1, s.media?.length ?? 0);
  return 1;
}

/**
 * Claims with no successful step of their kind in this run, or with fewer than the number they state
 * (STATE #8: "added 4 tasks" after one task.add used to pass). Tool names alone count one each.
 */
export function unbackedClaims(text: string, succeeded: (string | DoneStep)[]): Claim[] {
  const steps: DoneStep[] = succeeded.map((x) => (typeof x === 'string' ? { tool: x } : x));
  return findClaims(text).filter((c) => {
    const mine = steps.filter((s) => CLAIM_TOOLS[c.kind].includes(s.tool));
    if (!mine.length) return true;
    if (c.count && (c.kind === 'task' || c.kind === 'image' || c.kind === 'file' || c.kind === 'memory' || c.kind === 'schedule')) {
      return mine.reduce((n, s) => n + unitsOf(s), 0) < c.count;
    }
    return false;
  });
}

const WHAT: Record<ClaimKind, string> = {
  task: 'add or move a task', image: 'make an image', file: 'save a file', memory: 'save a memory', folder: 'look at your files', web: 'search the web',
  schedule: 'schedule a routine', delete: 'delete something', install: 'install something',
};
export const claimText = (c: Claim) => (c.count ? `${WHAT[c.kind]} (${c.count} said)` : WHAT[c.kind]);
