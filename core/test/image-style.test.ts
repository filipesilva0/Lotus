// 0.15.1: Photo examples pick a photo model instead of running on an anime one.
import { describe, expect, test } from 'bun:test';
import { imageStyle, modelForStyle } from '../../src/models/imageStyle';
import { IMAGE_STARTERS } from '../../src/data/starters';

describe('image model style', () => {
  test('names are sorted into photo, anime and general', () => {
    expect(imageStyle('illustriousXL_v01.safetensors')).toBe('anime');
    expect(imageStyle('noobaiXLNAIXL_vPred10.safetensors')).toBe('anime');
    expect(imageStyle('ponyDiffusionV6XL.safetensors')).toBe('anime');
    expect(imageStyle('juggernautXL_ragnarokBy.safetensors')).toBe('photo');
    expect(imageStyle('RealVisXL_V5.0.safetensors')).toBe('photo');
    expect(imageStyle('checkpoints/epicrealismXL.safetensors')).toBe('photo');
    expect(imageStyle('Z-Image Turbo z_image_turbo_bf16.safetensors')).toBe('photo');
    expect(imageStyle('sd_xl_base_1.0.safetensors')).toBe('general');
    expect(imageStyle('FLUX.2 Klein 4B')).toBe('general');
  });

  test('the Photo examples ask for a photo model; others leave the model alone', () => {
    expect(IMAGE_STARTERS.find((g) => g.id === 'photo')?.style).toBe('photo');
    expect(IMAGE_STARTERS.filter((g) => g.id !== 'photo').every((g) => !g.style)).toBe(true);
  });

  const anime = { id: 'a', name: 'illustriousXL_v01.safetensors', label: 'Illustrious XL' };
  const jugg = { id: 'j', name: 'juggernautXL_v9.safetensors', label: 'Juggernaut XL' };
  const base = { id: 'b', name: 'sd_xl_base_1.0.safetensors', label: 'SDXL base' };

  test('the review case: illustrious selected, Juggernaut installed → switch to Juggernaut', () => {
    const r = modelForStyle('photo', anime, [anime, jugg]);
    expect(r.switchTo?.id).toBe('j');
    expect(r.note).toContain('Juggernaut XL');
  });

  test('a photo model already selected is kept, with no message', () => {
    expect(modelForStyle('photo', jugg, [anime, jugg])).toEqual({});
  });

  test('no style wanted (Art, Design, Characters) → nothing changes', () => {
    expect(modelForStyle(undefined, anime, [anime, jugg])).toEqual({});
  });

  test('only anime and general models → use the general one rather than draw the photo', () => {
    const r = modelForStyle('photo', anime, [anime, base]);
    expect(r.switchTo?.id).toBe('b');
  });

  test('a general model selected and no photo model → keep it quietly', () => {
    expect(modelForStyle('photo', base, [anime, base])).toEqual({});
  });

  test('only an anime model → keep it, but say why the result may look drawn', () => {
    const r = modelForStyle('photo', anime, [anime]);
    expect(r.switchTo).toBeUndefined();
    expect(r.note).toContain('anime-style');
  });
});
