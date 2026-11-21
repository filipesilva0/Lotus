// 0.15.1: the image progress card counts sampling steps only (0.15.0 showed "178 of 178", "3 of 80", "29 of 45").
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageStage, sdcppProgress, sdcppStepCounts, sdcppStepReader } from '../../src/models/imageProfiles';

const realLog = readFileSync(join(import.meta.dir, 'fixtures', 'sdcpp-oom-rtx4060.txt'), 'utf8');

function feed(chunks: string[], steps: number, strength?: number) {
  const seen: string[] = [];
  const read = sdcppStepReader(steps, strength, (s, t) => seen.push(`${s}/${t}`));
  for (const c of chunks) read(c);
  return seen;
}

describe('sd-cli progress bars', () => {
  test('loading bars (MB/s, GB/s) are not steps', () => {
    expect(sdcppProgress('  |##################################################| 178/178 -   1.03GB/s')).toBeNull();
    expect(sdcppProgress('  |######| 15/15 - 193.63MB/s')).toBeNull();
    expect(sdcppProgress('  |=====>     | 5/20 - 1.23s/it')).toEqual({ step: 5, total: 20 });
    expect(sdcppProgress('  |=>   |  1/50 -   2.90s/it - ETA 02:21')).toEqual({ step: 1, total: 50 });
    expect(sdcppProgress('  |===>  | 7/30 - 3.10it/s')).toEqual({ step: 7, total: 30 });
  });

  test('the real RTX 4060 log only reports sampling steps', () => {
    // That run asked for 50 steps: the 178, 374, 15 and 1680 tensor bars must not show.
    expect(feed([realLog], 50)).toEqual(['1/50', '2/50']);
  });

  test('VAE tile bars (also s/it) are ignored, so the count never jumps', () => {
    const out = [
      '  |####| 178/178 -   1.03GB/s\x1b[K\n',
      '  |=>  |  1/30 -   1.2s/it\x1b[K  |==> |  2/30 -   1.1s/it\x1b[K',
      '  |=>  |  3/80 -   0.20s/it\x1b[K',                 // tiles while the weights stream in
      '  |===>|  3/30 -   1.1s/it\x1b[K',
      '  |====|  30/30 -   1.1s/it\x1b[K\n',
      '  |=>  |  45/80 -   0.20s/it\x1b[K',                // decoding tiles
    ];
    expect(feed(out, 30)).toEqual(['1/30', '2/30', '3/30', '30/30']);
  });

  test('a bar split across two chunks is read once, whole', () => {
    expect(feed(['  |====>   |  1', '2/30 - 1.1s/it\x1b[K'], 30)).toEqual(['12/30']);
  });

  test('works with carriage returns and stdout/stderr style newlines', () => {
    expect(feed(['|=> | 1/4 - 1.0s/it\r|==> | 2/4 - 1.0s/it\r', '|===>| 3/4 - 1.0s/it\r\n|====| 4/4 - 1.0s/it\n'], 4)).toEqual(['1/4', '2/4', '3/4', '4/4']);
  });

  test('from a start image, the shorter step count is accepted', () => {
    expect(sdcppStepCounts(30)).toEqual([30]);
    expect(sdcppStepCounts(30, 0.65)).toEqual(expect.arrayContaining([30, 19, 20]));
    expect(feed(['| 1/20 - 1s/it\x1b[K| 2/20 - 1s/it\x1b[K'], 30, 0.65)).toEqual(['1/20', '2/20']);
  });

  test('the card says Loading model, then steps, then Finishing', () => {
    expect(imageStage(null, true)).toBe('Loading model · ');
    expect(imageStage(null, false)).toBe('');
    expect(imageStage({ step: 3, total: 30 }, true)).toBe('Step 3 of 30 · ');
    expect(imageStage({ step: 30, total: 30 }, true)).toBe('Finishing · ');
  });
});
