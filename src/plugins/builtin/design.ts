// Design: Lotus's own versions of design skills (critique, accessibility, UX copy, handoff, design
// systems, user research, research synthesis, UI/UX process, Apple-platform conventions, charts).
// Written from scratch for Lotus; they do the same jobs as the design skills Claude uses, without
// copying their text. Figma, Slack, Notion and other connectors are not available, so the skills work
// from screenshots, descriptions, pasted text and files the user allows.

import type { BuiltinPluginDef } from './types';

export const DESIGN: BuiltinPluginDef = {
  id: 'builtin-design',
  name: 'Design',
  version: '1.0.0',
  description: 'Design critique, accessibility checks, UX copy, handoff specs, design systems, user research and charts.',
  author: 'Lotus',
  defaultOn: true,
  credit: { by: 'Lotus', license: 'Original', note: 'Written for Lotus. Does the same jobs as the design skills Claude uses, in Lotus’s own words.' },
  instructions: '',
  commands: [
    { name: 'critique', description: 'Structured feedback on a design or screenshot', prompt: 'Critique this design: first impression, usability, visual hierarchy, consistency and accessibility, then the top 3 fixes:\n\n{{input}}' },
    { name: 'a11y', description: 'Accessibility check (WCAG 2.1 AA)', prompt: 'Run an accessibility check (WCAG 2.1 AA) on this: contrast, keyboard, screen reader, touch targets, text. List issues by severity with a fix for each:\n\n{{input}}' },
    { name: 'ux-copy', description: 'Write or improve interface text', prompt: 'Write the interface text (UX copy) for this. Give a recommended version, two alternatives and a one-line reason:\n\n{{input}}' },
  ],
  skills: [
    {
      name: 'design-critique',
      description: 'Structured feedback on a screen, mockup or design.',
      whenToUse: 'Critique or review a design, mockup, screen, landing page, layout or screenshot and give design feedback.',
      body: `# Design critique

Ask what stage it is (rough idea or final polish) and what it must achieve, if not said.

## Look at, in order
1. **First impression** (2 seconds): what draws the eye? Is that the most important thing?
2. **Usability**: can someone do the main job without help? Are buttons and links obvious? Are there dead ends?
3. **Hierarchy**: one clear focal point per screen; size, weight and spacing show what matters.
4. **Consistency**: same spacing, colours, fonts, corner radius and wording for the same things.
5. **Accessibility**: contrast, text size, touch targets (44 px+), not relying on colour alone.

## Write it up
- What works well (2–3 points, specific).
- Problems, each with: where, why it matters, a concrete fix.
- The top 3 fixes, most important first.
Be direct and kind. Critique the design, not the designer.`,
    },
    {
      name: 'accessibility-review',
      description: 'WCAG 2.1 AA accessibility audit of a design or web page.',
      whenToUse: 'Audit accessibility (a11y, WCAG, contrast, screen reader, keyboard navigation) of a design, app or web page.',
      body: `# Accessibility review (WCAG 2.1 AA)

## Check
- **Contrast**: body text 4.5:1, large text (24 px, or 19 px bold) and icons 3:1.
- **Text**: resizes to 200% without breaking; no text in images.
- **Colour**: never the only way to show meaning (add icons or words to errors).
- **Keyboard**: everything works with Tab, Enter, Space, Esc; focus is visible; logical order; no traps.
- **Screen reader**: images have alt text; buttons and fields have names; headings in order; form errors are announced.
- **Touch**: targets at least 44×44 px with space between.
- **Motion**: nothing flashes more than 3 times a second; respect "reduce motion".
- **Forms**: visible labels (not only placeholders); errors say how to fix.

For a live web page, read its HTML with web.read or browser.read and check the source, not just how it looks.

## Report
A table: issue · where · WCAG criterion · severity (critical / major / minor) · fix. Then the 3 fixes to do first.`,
    },
    {
      name: 'ux-copy',
      description: 'Write or review interface text: buttons, errors, empty states, dialogs.',
      whenToUse: 'Write or review UX copy or microcopy: button labels, error messages, empty states, confirmation dialogs, onboarding text.',
      body: `# UX copy

## Principles
- Clear beats clever. Short beats long. Say what happens.
- Use the user's words, not the system's ("Couldn't save", not "Error 500").
- Same word for the same thing everywhere.

## Patterns
- **Buttons**: verb + object ("Save draft", "Delete photo"). Not "OK" or "Submit".
- **Errors**: what happened + how to fix it. No blame, no codes alone. "That email is missing an @."
- **Empty states**: what goes here + the first action. "No projects yet. Create one to get started."
- **Confirmations**: the title asks the question with the object; the button repeats the verb ("Delete 3 files?" → "Delete"). Say if it cannot be undone.
- **Loading**: say what is happening ("Saving…"); for long waits, give progress.

## Output
Recommended text, two alternatives, a one-line reason. Note anything that may get much longer in other languages.`,
    },
    {
      name: 'design-handoff',
      description: 'A developer spec for a finished design: layout, tokens, states, edge cases.',
      whenToUse: 'Write a design handoff or developer spec for a finished design, screen or component before engineers build it.',
      body: `# Design handoff spec

Write it so a developer can build without guessing.

1. **Overview**: what the screen is for, the main user flow.
2. **Layout**: structure, spacing, sizes, grid; how it changes on small and large screens.
3. **Tokens**: the colours, fonts, spacing and radius names used (not raw values when tokens exist).
4. **Components**: each one with its variants and properties.
5. **States**: default, hover, focus, pressed, disabled, loading, empty, error, success.
6. **Interactions**: what each click, key and gesture does; animations with duration and easing.
7. **Content**: real text, longest and shortest cases, number and date formats.
8. **Edge cases**: no data, very long names, slow network, no permission, offline.
9. **Accessibility**: focus order, labels, keyboard shortcuts, contrast notes.

Save it as a document with artifact.write when it is long.`,
    },
    {
      name: 'design-system',
      description: 'Audit, document or extend a design system: tokens, components, patterns.',
      whenToUse: 'Audit, document or extend a design system: design tokens, component library, naming, variants and patterns.',
      body: `# Design system

## Audit
- **Naming**: same pattern everywhere (e.g. color-text-muted, not greyText2).
- **Tokens**: find hard-coded colours, sizes and spacing that should be tokens (search the files with files.search).
- **Components**: list each with its variants and states; find duplicates that do the same job.
- Report: what is consistent, what is not, the top 5 actions.

## Document a component
Description and when to use it · variants · properties · states · accessibility · do's and don'ts · a short code example.

## Extend
Before adding a component, check an existing one cannot do the job. Reuse existing tokens. Define every state. Name it like its siblings.`,
    },
    {
      name: 'user-research',
      description: 'Plan user research: interview guides, usability tests, surveys.',
      whenToUse: 'Plan user research: an interview guide, usability test, survey design or research questions about users.',
      body: `# User research

1. **Goal**: what decision will this research help make? Write 2–4 research questions.
2. **Method**:
   - Interviews (5–8 people): why people do things.
   - Usability test (5 people): where a design confuses people.
   - Survey (many people): how common something is.
3. **Who**: describe the people to talk to and how to find them.
4. **Interview guide**: warm-up → their current way of doing it → specific recent stories → reactions to ideas → wrap-up. Open questions ("Tell me about the last time…"). No leading questions ("Wouldn't it be great if…").
5. **Usability test**: realistic tasks with a goal, not instructions ("Book a table for Friday", not "Click Book").
6. **Survey**: short, one idea per question, balanced answer scales, an "other" option.
7. Plan how notes will be kept and synthesised (see research-synthesis).`,
    },
    {
      name: 'research-synthesis',
      description: 'Turn interviews, surveys or feedback into themes, insights and next steps.',
      whenToUse: 'Synthesise user research: interview notes, transcripts, survey results, usability findings, reviews or support tickets into themes and insights.',
      body: `# Research synthesis

1. Read everything first (attached files: files.read). Note who said what.
2. Pull out observations: quotes, behaviours, pain points, one per line, with the source.
3. Group them into themes. A theme needs evidence from more than one person.
4. For each theme write an **insight**: what is true and why it matters ("People export to Excel because they don't trust our totals").
5. Turn insights into **opportunities** ("How might we…").
6. Note user groups that behave differently.
7. Recommend next steps, most impact first, and list open questions.

Say how many people each theme comes from. Do not invent quotes or numbers.`,
    },
    {
      name: 'ui-ux-design',
      description: 'Design a new screen, app, page or flow step by step, from goal to polished screens.',
      whenToUse: 'Design or redesign an app, website, dashboard, onboarding flow or screen layout (UI/UX design, wireframe).',
      body: `# UI/UX design process

1. **Clarify**: who uses it, the one main job, the device, any brand. Ask if unknown.
2. **Flow**: list the steps the user takes from start to goal. Remove steps.
3. **Structure**: what goes on each screen, in order of importance. Sketch a wireframe in words or simple HTML.
4. **Tokens first**: a small palette (one accent), one or two fonts, a spacing scale (4/8/12/16/24/32), corner radius.
5. **Screens**: one focal point each; group related things; generous spacing; left-aligned text.
6. **States**: empty, loading, error, success, long content, dark mode.
7. **Review**: check with design-critique and accessibility-review.

## Useful numbers
Body text 16 px; line height 1.4–1.6; lines 45–75 characters; touch targets 44 px; contrast 4.5:1.

To show a mockup, write a self-contained page with artifact.write (.html).`,
    },
    {
      name: 'apple-platform-design',
      description: 'Apple-style app design: iPhone, iPad, Mac and Watch conventions.',
      whenToUse: 'Design or review an app for iPhone, iPad, Mac, Apple Watch or visionOS following Apple conventions (Human Interface Guidelines, iOS style).',
      body: `# Designing for Apple platforms

General conventions, in Lotus's words. Check Apple's Human Interface Guidelines for exact, current rules.

## Principles
- Content first; controls stay out of the way.
- Use the system's standard parts (tab bars, navigation bars, sheets, lists) so the app feels familiar.
- Support Dynamic Type (text the user can enlarge), Dark Mode and VoiceOver.

## iPhone and iPad
- Tab bar for 3–5 top-level sections; navigation bar with a clear title and Back.
- Touch targets at least 44×44 pt. Keep content inside the safe areas.
- Sheets for short tasks; full screens for long ones. Confirm destructive actions.
- iPad: use the extra space (sidebars, split views); support keyboard and pointer.

## Mac
- Menu bar holds every command, with keyboard shortcuts. Windows resize. Sidebar plus content.
- Respect standard shortcuts (⌘S, ⌘Z, ⌘W…).

## Watch
- Glanceable: one idea per screen, large type, very short sessions.

## Visual
System font (San Francisco) and system colours adapt to Dark Mode and accessibility settings. Use SF Symbols-style icons for consistency.`,
    },
    {
      name: 'charts-and-graphs',
      description: 'Choose and design clear charts, graphs and dashboards.',
      whenToUse: 'Make a chart or graph (bar chart, line chart, pie chart, plot) or a dashboard: data visualization, chart colours, axis, legend.',
      body: `# Charts and data visualisation

## Pick the chart
- Compare categories → bar chart (horizontal when labels are long).
- Change over time → line chart.
- Part of a whole → stacked bar, or a pie only with 2–4 parts.
- Relationship between two numbers → scatter plot.
- One key number → a big number with its change ("1,240 ▲ 12%").

## Design
- Start bar axes at zero. Label axes with units.
- Label lines directly instead of a far-away legend.
- Few colours: grey for context, one accent for what matters. Same colour = same thing in every chart.
- Colour-blind safe; never colour alone (add labels or patterns).
- Title says the finding ("Sales doubled in May"), not just "Sales".
- Remove gridline clutter, 3D, shadows.

## In Lotus
Save data as .csv, or a chart as .svg or a self-contained .html page (inline SVG, no external scripts) with artifact.write. Check the numbers add up before drawing.`,
    },
  ],
};
