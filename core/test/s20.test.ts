// 0.9.6: voice calls, whole-text stories, transcripts in their own language with translation,
// image resolution, example prompts.

import { describe, expect, test } from 'bun:test';
import { callSystemPrompt, callTitle, cleanModelText, paragraphs, parseScript, scriptSpeakers, takeSentences, translatePrompt, translationParts, TRANSLATE_LANGS } from '../../src/voice/studio';
import { RESOLUTIONS, resolutionFit, sizeFor, type ImageProfile } from '../../src/models/imageProfiles';
import { dimensionsFor } from '../../src/services/comfyGraph';
import { CHAT_STARTERS, IMAGE_STARTERS, WORK_STARTERS } from '../../src/data/starters';

describe('stories from a whole text', () => {
  test('blank lines separate paragraphs; line breaks inside one become spaces', () => {
    const t = 'First line\nstill the first.\n\n\nSecond paragraph.\r\n  \r\nThird.';
    expect(paragraphs(t)).toEqual(['First line still the first.', 'Second paragraph.', 'Third.']);
  });
  test('a text without blank lines has one paragraph per line', () => {
    expect(paragraphs('One.\nTwo.\n\nThree.')).toEqual(['One. Two.', 'Three.']);
    expect(paragraphs('One.\nTwo.')).toEqual(['One.', 'Two.']);
    expect(paragraphs('   ')).toEqual([]);
  });
  test('each paragraph is a line; "Name:" at its start switches the speaker', () => {
    const t = 'It was late.\nThe sea was calm.\n\nAna: Did you see that?\nIt blinked.\n\nThe light went out.';
    expect(parseScript(t, { ana: 'a' }, 'n', 'paragraph')).toEqual([
      { speaker: '', voice: 'n', text: 'It was late. The sea was calm.' },
      { speaker: 'Ana', voice: 'a', text: 'Did you see that? It blinked.' },
      { speaker: 'Ana', voice: 'a', text: 'The light went out.' },
    ]);
    expect(scriptSpeakers(t, 'paragraph')).toEqual(['Ana']);
    // Script mode is unchanged: one line per line.
    expect(parseScript('Ana: Hi\nthere', {}, 'f').length).toBe(2);
  });
});

describe('translation', () => {
  test('long texts are sent in parts; prompts ask for the translation only', () => {
    const long = 'Uma frase curta. '.repeat(400);
    const parts = translationParts(long, 2400);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => p.length <= 2400)).toBe(true);
    expect(translatePrompt('English', 'Olá')).toContain('into English');
    expect(translatePrompt('English', 'Olá')).toContain('Olá');
    expect(TRANSLATE_LANGS).toContain('Portuguese (Portugal)');
  });
  test('model replies lose thinking and markers', () => {
    expect(cleanModelText('<think>hmm</think>\nHello there')).toBe('Hello there');
    expect(cleanModelText('reasoning…</think> Hi')).toBe('Hi');
    expect(cleanModelText('<<<\nHi\n>>>')).toBe('Hi');
  });
});

describe('voice calls', () => {
  test('finished sentences are spoken while the rest is still written', () => {
    expect(takeSentences('Hello there, how are you? I am fine and')).toEqual({ sentences: ['Hello there, how are you?'], rest: 'I am fine and' });
    // Short pieces wait for more words ("Dr.", "1.").
    expect(takeSentences('Dr. Silva said').sentences).toEqual([]);
    expect(takeSentences('No full stop yet').sentences).toEqual([]);
    expect(takeSentences('The last words', true)).toEqual({ sentences: ['The last words'], rest: '' });
    const a = takeSentences('Olá! Tudo bem contigo hoje? Sim. Estou ótimo, obrigado. ');
    expect(a.sentences).toEqual(['Olá! Tudo bem contigo hoje?', 'Sim. Estou ótimo, obrigado.']);
  });
  test('the call prompt asks for short spoken replies in the user\'s language, with the last call', () => {
    const p = callSystemPrompt({ date: new Date(2026, 10, 16), recent: [{ role: 'user', text: 'My exam is on Friday', ts: 1 }, { role: 'assistant', text: 'Good luck!', ts: 2 }] });
    expect(p).toContain('language the user speaks');
    expect(p).toContain('No lists');
    expect(p).toContain('User: My exam is on Friday');
    expect(p).toContain('You: Good luck!');
    expect(callSystemPrompt({ persona: 'You are Ana.', date: new Date() })).toStartWith('You are Ana.');
  });
  test('a call is named after the first thing said', () => {
    expect(callTitle([])).toBe('Voice call');
    expect(callTitle([{ role: 'assistant', text: 'Hi', ts: 0 }, { role: 'user', text: 'Help me plan my week', ts: 1 }])).toBe('Help me plan my week');
    expect(callTitle([{ role: 'user', text: 'x'.repeat(80), ts: 1 }]).length).toBeLessThanOrEqual(48);
  });
});

describe('image resolution', () => {
  const sdxl = { id: 'p', name: 'SDXL', family: 'sdxl', main: 'a.safetensors', slots: {} } as unknown as ImageProfile;
  test('the model default keeps the old sizes; a resolution keeps the shape and changes the area', () => {
    expect(sizeFor('1:1', sdxl)).toEqual({ width: 1024, height: 1024 });
    expect(sizeFor('1:1', sdxl, 0)).toEqual({ width: 1024, height: 1024 });
    expect(sizeFor('1:1', sdxl, 512)).toEqual({ width: 512, height: 512 });
    const wide = sizeFor('16:9', sdxl, 2048);
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 1);
    expect(wide.width % 64 + wide.height % 64).toBe(0);
    // A custom size wins over the resolution.
    expect(sizeFor('800x600', sdxl, 2048)).toEqual({ width: 832, height: 576 });
    expect(dimensionsFor('1:1', 'v1-5-pruned.safetensors')).toEqual({ width: 512, height: 512 });
    expect(dimensionsFor('1:1', 'v1-5-pruned.safetensors', 768)).toEqual({ width: 768, height: 768 });
  });
  test('resolutions offered and how they compare with the model', () => {
    expect(RESOLUTIONS[0].id).toBe(0);
    expect(RESOLUTIONS.map((r) => r.id)).toContain(2048);
    expect(resolutionFit(0, 1024)).toBe('ok');
    expect(resolutionFit(1024, 1024)).toBe('ok');
    expect(resolutionFit(2048, 1024)).toBe('large');
    expect(resolutionFit(512, 1024)).toBe('small');
  });
});

describe('example prompts', () => {
  test('every page has complete examples with a role and something to fill in', () => {
    for (const groups of [CHAT_STARTERS, WORK_STARTERS, IMAGE_STARTERS]) {
      expect(groups.length).toBeGreaterThanOrEqual(3);
      for (const g of groups) {
        expect(g.items.length).toBeGreaterThanOrEqual(3);
        for (const s of g.items) { expect(s.title.length).toBeGreaterThan(2); expect(s.text.length).toBeGreaterThan(80); }
      }
    }
    for (const g of [...CHAT_STARTERS, ...WORK_STARTERS]) for (const s of g.items) expect(s.text).toStartWith('Act as');
    const titles = [...CHAT_STARTERS, ...WORK_STARTERS, ...IMAGE_STARTERS].flatMap((g) => g.items.map((s) => `${g.id}/${s.title}`));
    expect(new Set(titles).size).toBe(titles.length);
  });
});
