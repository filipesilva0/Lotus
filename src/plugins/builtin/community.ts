// Two small MIT plugins, adapted for Lotus with their notices kept (THIRD_PARTY_LICENSES.md):
//   • Site Audit, from rjspence3/claude-site-audit 1.0.0 (MIT, Rob Spence). Its PDF script and
//     reference files are not included; Lotus reads the page with web.read/browser.read and writes the
//     report as an HTML or Markdown artifact instead.
//   • Caveman, from akramsystems/caveman 1.1.2 (MIT, Copyright (c) 2026 Ali Akram).

import type { BuiltinPluginDef } from './types';

export const SITE_AUDIT: BuiltinPluginDef = {
  id: 'builtin-site-audit',
  name: 'Site Audit',
  version: '1.0.0',
  description: 'Grade a website for SEO, accessibility, AI search readiness and usability.',
  author: 'Rob Spence, adapted for Lotus',
  defaultOn: true,
  credit: { by: 'Rob Spence (rjspence3/claude-site-audit)', license: 'MIT', url: 'https://github.com/rjspence3/claude-site-audit', note: 'Adapted for Lotus: reads pages with Lotus’s web tools and writes the report as a file instead of a PDF. MIT licence, Rob Spence.' },
  instructions: '',
  commands: [
    { name: 'site-audit', description: 'Audit a website and grade it', prompt: 'Audit this website for SEO, accessibility, AI search readiness and usability. Score each check PASS / PARTIAL / FAIL, give a letter grade and the top fixes:\n\n{{input}}' },
  ],
  skills: [
    {
      name: 'site-audit',
      description: 'Audit a website for SEO, accessibility, GEO (AI search) and usability, with a grade.',
      whenToUse: 'Audit, grade or check a website or URL for SEO, accessibility, structured data, AI search visibility (GEO) or a website report card.',
      body: `# Website audit

1. Get the URL, the organisation's name and type (shop, restaurant, council, library, museum…).
2. Read the page's HTML with web.read (or browser.open + browser.read). Judge the source, not how it looks.
3. Score each check PASS / PARTIAL / FAIL with a short note:
   - **Basics**: HTTPS · mobile viewport meta tag · page title (50–60 chars) · meta description
   - **SEO**: one h1 and ordered headings · descriptive link text · image alt text · canonical link · sitemap.xml and robots.txt (web.read /robots.txt)
   - **Accessibility**: html lang attribute · form labels · skip link · contrast hints · no text-only-in-images
   - **AI search (GEO)**: structured data (JSON-LD schema.org) · clear "about" facts (who, where, hours) · /llms.txt · AI crawlers not blocked in robots.txt
   - **Usability**: contact info visible · clear navigation · key services reachable in one click · language options if the audience needs them
4. Give scores out of 10 for accessibility, SEO, GEO and usability, and an overall letter grade (A ≥ 90%, B ≥ 80%, C ≥ 70%, D ≥ 60%, else F).
5. List key issues and the top 5 fixes, most impact first, with why it matters for this type of organisation.
6. Save the report with artifact.write (audit.html, print-friendly so it can be saved as PDF). For several sites, also a summary .csv: name, URL, grade, the four scores, top issue.`,
    },
  ],
};

export const CAVEMAN: BuiltinPluginDef = {
  id: 'builtin-caveman',
  name: 'Caveman',
  version: '1.1.2',
  description: 'Lotus talks like a caveman: short words, short sentences, no fluff. Turn on for blunt answers.',
  author: 'Ali Akram, adapted for Lotus',
  defaultOn: false,
  credit: { by: 'Ali Akram (akramsystems/caveman)', license: 'MIT', url: 'https://github.com/akramsystems/caveman', note: 'Adapted for Lotus. MIT licence, Copyright (c) 2026 Ali Akram.' },
  instructions: `Caveman mode is on. Talk like caveman.
- Short words. Short sentence. Many short sentence beat one long one.
- No filler ("basically", "in order to"). No praise ("great question"). Just answer.
- Three bullets max, about five words each.
- Small word over big word: use not utilize, make not implement, so not therefore, but not however, change not modify.
- Drop "the" and "a" sometimes, but stay readable.
- Code, file names, numbers and error names stay exact. Tool calls stay normal.
- User says "stop caveman" or "normal mode": talk normal again.
Example: "Test hit real network. Slow. Mock the call. Test fast."`,
  commands: [
    { name: 'caveman', description: 'Answer this one like a caveman', prompt: 'Answer like a caveman: short words, short sentences, no fluff, three bullets max. Keep code and names exact.\n\n{{input}}' },
  ],
  skills: [],
};
