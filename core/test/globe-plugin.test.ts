// 0.21: the Globe plugin (adapted from God's Eye View, MIT) and web.read opening JSON and CSV feeds.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_PLUGINS, builtinPlugins } from '../../src/plugins/builtin';
import { matchPluginSkills } from '../../src/plugins/block';
import { dataText, isDataType, readPageWith, type WebIO } from '../../src/chat/webCore';

const globe = BUILTIN_PLUGINS.find((p) => p.id === 'builtin-globe')!;

describe('Globe plugin', () => {
  test('is built in, on by default, and credits God’s Eye View under MIT', () => {
    expect(globe).toBeDefined();
    expect(globe.defaultOn).toBe(true);
    expect(globe.credit.license).toBe('MIT');
    expect(globe.credit.url).toBe('https://github.com/bilawalsidhu/gods-eye-view');
    expect(globe.credit.note).toContain('Bilawal Sidhu');
    const notices = readFileSync(join(import.meta.dir, '..', '..', 'THIRD_PARTY_LICENSES.md'), 'utf8');
    expect(notices).toContain('Copyright (c) 2026 Bilawal Sidhu');
    expect(notices).toContain('trademark of Metaversity LLC');
    // Its own name, since God's Eye View is a trademark.
    expect(globe.name).toBe('Globe');
  });

  test('keeps the “places and things, never people” rule and the not-for-safety warning', () => {
    const body = globe.skills.find((k) => k.name === 'live-world')!.body;
    expect(body).toContain('never people');
    expect(body).toContain('navigation or safety');
    expect(body).toContain('mcp.gev_');
  });

  const all = builtinPlugins();
  const top = (q: string) => matchPluginSkills(q, all, 2)[0]?.skill.name ?? null;
  const cases: [string, string][] = [
    ['were there any earthquakes near Lisbon this week?', 'live-world'],
    ['where is the ISS right now', 'live-world'],
    ['what planes overhead London', 'live-world'],
    ['any wildfires in California', 'live-world'],
    ['when is the next rocket launch', 'live-world'],
    ['put these earthquakes on a map', 'globe-map'],
    ['how do I connect God’s Eye View to Lotus', 'connect-gods-eye-view'],
  ];
  for (const [q, want] of cases) test(`“${q}” → ${want}`, () => expect(top(q)).toBe(want));

  test('everyday travel and weather chat does not pull it in', () => {
    for (const q of ['what is the weather today', 'plan my trip to Porto', 'book cheap flights to Paris', 'make a chart'])
      expect({ q, skill: top(q) as string | null }).toEqual({ q, skill: null });
  });
});

describe('web.read opens data feeds', () => {
  const io = (type: string, body: string): WebIO => ({
    fetch: async () => new Response(body, { headers: { 'content-type': type } }),
    timeout: (ms) => AbortSignal.timeout(ms),
  });

  test('JSON, GeoJSON and CSV count as data; images do not', () => {
    for (const t of ['application/json', 'application/geo+json; charset=utf-8', 'application/vnd.api+json', 'text/csv', 'text/json']) expect(isDataType(t)).toBe(true);
    for (const t of ['text/html', 'image/png', 'application/pdf']) expect(isDataType(t)).toBe(false);
  });

  test('JSON is made compact and long answers are cut with a note', () => {
    expect(dataText('{ "a": 1,\n  "b": [1, 2] }', 'application/json')).toBe('{"a":1,"b":[1,2]}');
    expect(dataText('not { json', 'application/json')).toBe('not { json');
    const long = dataText('x'.repeat(20_000), 'text/csv');
    expect(long.length).toBeLessThan(12_200);
    expect(long).toContain('cut at 12,000 characters');
  });

  test('a GeoJSON earthquake feed is read instead of refused', async () => {
    const geo = JSON.stringify({ type: 'FeatureCollection', features: [{ properties: { mag: 4.6, place: '10 km S of Lisbon' }, geometry: { coordinates: [-9.1, 38.6, 10] } }] }, null, 2);
    const page = await readPageWith(io('application/geo+json', geo), 'https://earthquake.usgs.gov/x');
    expect(page.error).toBeUndefined();
    expect(page.text).toContain('"mag":4.6');
    const csv = await readPageWith(io('text/csv', 'time,latitude,longitude,mag\n2026-11-21T10:00:00Z,38.6,-9.1,4.6'), 'https://earthquake.usgs.gov/y');
    expect(csv.text).toContain('38.6,-9.1,4.6');
    const png = await readPageWith(io('image/png', 'x'), 'https://example.com/a.png');
    expect(png.error).toContain('Not a web page');
  });
});
