// 0.20 consistency pass: one assistant name from the Soul, friendly model and voice names, tool abilities.
import { describe, expect, test } from 'bun:test';
import { assistantName } from '../../src/lib/identity';
import { prettyModelName } from '../../src/models/names';
import { voiceLabel, voiceOptions } from '../../src/voice/studio';
import { toolLabel } from '../../src/lib/toolLabel';

describe('assistant name from the Soul', () => {
  test.each([
    ["You are Lotus, a helpful AI assistant running locally on the user's computer.", 'Lotus'],
    ['You are Aura, a warm companion.', 'Aura'],
    ['Your name is Ana. Always answer in Portuguese.', 'Ana'],
    ['Call yourself Tugão from now on.', 'Tugão'],
    ['You are a helpful assistant.', 'Lotus'],
    ['you are helpful', 'Lotus'],
    ['', 'Lotus'],
    ['You are Lotus Pro, the best', 'Lotus Pro'],
  ])('%p → %p', (soul, name) => expect(assistantName(soul)).toBe(name));
});

describe('model names', () => {
  test.each([
    ['gemma-4-12b', 'Gemma 4 12B'], ['gemma4:12b', 'Gemma 4 12B'], ['qwen3:8b', 'Qwen 3 8B'],
    ['llama3.2:3b', 'Llama 3.2 3B'], ['Qwen3-8B-Q4_K_M.gguf', 'Qwen 3 8B'], ['mistral-small3.2:24b', 'Mistral Small 3.2 24B'],
    ['sdxl-fake.safetensors', 'SDXL Fake'],
  ])('%p → %p', (id, name) => expect(prettyModelName(id)).toBe(name));
  test('empty stays empty', () => expect(prettyModelName('')).toBe(''));
});

describe('voice names', () => {
  test('engine moves to the subtitle', () => {
    expect(voiceLabel('Piper · Alba (British English)')).toEqual({ name: 'Alba · British English', engine: 'Piper' });
    expect(voiceLabel('Kokoro')).toEqual({ name: 'Kokoro', engine: 'Kokoro' });
  });
  test('a saved copy of a built-in voice is listed once', () => {
    const models = [{ id: 'piper-pt-pt-tugao', title: 'Piper · Tugão (European Portuguese)', speakers: [], clones: false, needsReferenceText: false }];
    const opts = voiceOptions(models, [{ id: 'v1', name: 'Piper · Tugão', model: 'piper-pt-pt-tugao', created: 1 }]);
    expect(opts.map((o) => `${o.name} | ${o.detail}`)).toEqual(['Tugão | Your voice · Piper']);
  });
});

test('tool abilities read as verbs', () => {
  expect(toolLabel('Changing its soul')).toBe('Change the Soul');
  expect(toolLabel('Making an image')).toBe('Make an image');
  expect(toolLabel('Searching the web')).toBe('Search the web');
});
