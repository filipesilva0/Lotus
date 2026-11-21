// Superpowers, adapted from obra/superpowers 7.0.2 (MIT, Copyright (c) 2025 Jesse Vincent).
// The skills are shortened and reworded for small local models and for Lotus's tools; the ideas and
// rules are Jesse Vincent's. Skipped: using-superpowers and diagnosing-superpowers (about Claude Code
// itself), using-git-worktrees and finishing-a-development-branch (Lotus has no git or terminal).
// dispatching-parallel-agents and subagent-driven-development are merged into delegating-to-helpers.

import type { BuiltinPluginDef } from './types';

export const SUPERPOWERS: BuiltinPluginDef = {
  id: 'builtin-superpowers',
  name: 'Superpowers',
  version: '7.0.2',
  description: 'Ways of working: brainstorm before building, debug by finding the cause, test first, plan, check before saying done.',
  author: 'Jesse Vincent (obra), adapted for Lotus',
  defaultOn: true,
  credit: { by: 'Jesse Vincent (obra/superpowers)', license: 'MIT', url: 'https://github.com/obra/superpowers', note: 'Adapted and shortened for small local models. MIT licence, Copyright (c) 2025 Jesse Vincent.' },
  instructions: '',
  commands: [
    { name: 'brainstorm', description: 'Shape an idea with questions before building it', prompt: 'Brainstorm this with me before building anything. Ask me one question at a time, then suggest 2–3 approaches and recommend one:\n\n{{input}}' },
    { name: 'debug', description: 'Find the root cause of a bug before fixing it', prompt: 'Help me debug this. Find the root cause first (read the error, reproduce, compare with what works), then propose one fix:\n\n{{input}}' },
    { name: 'write-plan', description: 'Turn a goal into a step-by-step plan', prompt: 'Write a step-by-step plan for this. Small steps, each with how to check it worked. Do not start the work yet:\n\n{{input}}' },
  ],
  skills: [
    {
      name: 'brainstorming',
      description: 'Find out what the user really wants before building or creating something new.',
      whenToUse: 'Brainstorm or shape an idea before building or creating it: a new feature, app, website, project, business, talk or event, when the goal is still unclear.',
      body: `# Brainstorming

Before building, find out what the user really wants and why.

## First: what do you know?
- Everything is in the request ("make the icon blue"): just do it and say what you did.
- Something important is missing: talk first.

## How to talk
1. Look before you ask. Read the files, notes or earlier messages they gave you. Never ask what they already told you.
2. Ask ONE question per message, in plain words. Say why you ask: what the answer changes.
3. Good first question: what should happen when someone uses it? Who is it for?
4. When you understand, lay out 2–3 approaches. For each: one line on what it is and what it trades off. Say which you recommend and why.
5. Let the user pick. Then write a short design (a few lines or bullets) and ask them to approve it.
6. Only after approval, make a plan (see writing-plans) and start.

## Rules
- If they say "just do it", stop asking: state your main choice in one line and build.
- Keep it small. Leave out features nobody asked for.
- No jargon. Match the user's words.`,
    },
    {
      name: 'systematic-debugging',
      description: 'Find the root cause of a bug, error or failure before trying any fix.',
      whenToUse: 'Debug a bug, error, crash, failing test, or code or an app that stopped working; find the root cause before fixing.',
      body: `# Systematic debugging

**Rule: no fix until you know the root cause.** Guessing wastes time.

## 1. Investigate
- Read the whole error message and stack trace. Note file names, line numbers, codes.
- Reproduce it: what exact steps make it happen? Every time?
- What changed recently? (new code, update, setting, file)
- Read the code around the error with files.read. Trace the bad value back to where it starts.

## 2. Compare
- Find a similar thing that works. List every difference between working and broken.

## 3. One hypothesis at a time
- Say it plainly: "I think X causes this because Y."
- Test it with the smallest possible change or check. One change at a time.
- Wrong? Make a new hypothesis. Do not stack fixes.

## 4. Fix
- Fix the cause, not the symptom. If possible, first write a test that fails because of the bug.
- After 3 failed fixes, stop: the design may be wrong. Tell the user what you found.

You cannot run programs: when a step needs a command or a test run, give the user the exact command and ask them to paste the output.`,
    },
    {
      name: 'test-driven-development',
      description: 'Write a failing test first, then the smallest code that makes it pass.',
      whenToUse: 'Write code test first (TDD, unit tests): add a feature or fix a bug by writing a failing test before the code.',
      body: `# Test-driven development

**Rule: no new code without a failing test first.**

## The cycle
1. **Red**: write ONE small test for the behaviour you want. Clear name, real code, no mocks unless unavoidable.
2. **Check red**: the test must fail, for the right reason (the feature is missing, not a typo).
3. **Green**: write the simplest code that makes it pass. Nothing extra.
4. **Check green**: this test and all other tests pass.
5. **Clean up**: tidy names and duplication; tests stay green.
6. Next behaviour: back to 1.

## Bug fixes
Write a test that reproduces the bug first. It fails. Fix. It passes. The bug can never come back silently.

## Pitfalls
- Code written before its test: start again from the test.
- A test that passes at once proves nothing. Make it fail first.
- "Too simple to test" code breaks too.

You cannot run the tests yourself: give the user the exact test command and ask for the output at each check.`,
    },
    {
      name: 'writing-plans',
      description: 'Break a multi-step job into small, checkable steps before starting it.',
      whenToUse: 'Write an implementation plan or step by step plan for a multi-step coding or project job before starting the work.',
      body: `# Writing plans

Write the plan for someone who does not know the project.

## Steps
1. One line: the goal. One line: the approach.
2. List the files (or parts) that will be created or changed, and what each one is for.
3. Break the work into small tasks (each a few minutes). Each task says:
   - exactly what to do (file, function, text)
   - how to check it worked (a test, a command, what to look at)
4. Order: things others depend on first. Tests before code.
5. Keep it lean: nothing that was not asked for.

## In Lotus
- Use plan.set with 3–8 short steps so the user sees the checklist.
- Save a longer plan as a document with artifact.write (for example plan.md).
- Ask the user to approve the plan before starting.`,
    },
    {
      name: 'executing-plans',
      description: 'Carry out an approved plan step by step, checking each step.',
      whenToUse: 'Carry out, follow or execute an existing plan step by step and track the progress.',
      body: `# Executing plans

1. Read the whole plan first. If something is unclear or looks wrong, ask before starting.
2. Put the steps in plan.set if they are not there yet.
3. Do ONE step at a time, exactly as written. Run its check.
4. Mark it done with plan.check only when its check passed.
5. Blocked (missing file, failing check, unclear step)? Stop and tell the user. Do not guess around it.
6. At the end, check the whole result against the goal (see verification-before-completion) and report what was done.`,
    },
    {
      name: 'verification-before-completion',
      description: 'Check with real evidence before saying work is done, fixed or working.',
      whenToUse: 'Verify, check or confirm work is really finished, fixed or passing before saying it is done or complete.',
      body: `# Verify before you say "done"

**Rule: no claim without fresh evidence.**

Before saying something works, is fixed or is finished:
1. Which check proves it? (a test run, reading the saved file back, the page loading, the numbers adding up)
2. Do that check now, fully.
3. Read the result. Count failures.
4. Say what the result really shows, with the evidence. If it failed, say so.

## Red flags
- Words like "should work", "probably", "looks right".
- Saying "Done!" before checking.
- Trusting a helper agent's "success" without looking at what it made.

If you cannot run the check yourself, say "Not checked yet" and tell the user exactly how to check it.`,
    },
    {
      name: 'receiving-code-review',
      description: 'Weigh code review feedback on its merits before changing anything.',
      whenToUse: 'Respond to code review feedback or review comments on your code; decide which review suggestions to apply.',
      body: `# Receiving code review

1. Read all the feedback before replying.
2. For each point: restate it in your own words. If unclear, ask.
3. Check it against the code. Is it right for THIS project?
4. Right: fix it, one point at a time, and check each fix.
5. Wrong or harmful: say so politely, with the technical reason.
6. No empty agreement ("Great point!"). Just fix it, or explain why not.
7. Do not add things nobody asked for while fixing.`,
    },
    {
      name: 'requesting-code-review',
      description: 'Have a helper agent review finished code before it is merged or shipped.',
      whenToUse: 'Request a code review of finished changes before merging or shipping code.',
      body: `# Requesting code review

1. Say what changed and why, in two or three lines.
2. Give a helper the job with agent.delegate: the goal, the changed files and what to check (bugs, missing tests, the requirement).
3. Read its findings. Fix the serious ones at once; note the small ones.
4. Disagree with a finding? Check the code; push back with the reason if it is wrong.
5. Never treat "no findings" as proof: still run the checks yourself (see verification-before-completion).`,
    },
    {
      name: 'delegating-to-helpers',
      description: 'Split big work into independent parts and give them to helper agents.',
      whenToUse: 'Split big work into independent parts for helper agents: delegate, deploy agents in parallel, several separate pieces.',
      body: `# Delegating to helper agents

Use helpers when the job has parts that do not depend on each other.

1. Split the job. Each part must make sense on its own and not touch the same file as another part.
2. Write each helper's job so it needs nothing else: the goal, the facts and file names it needs, and exactly what to return.
3. One part → agent.delegate. Two to six parts at once → agents.deploy.
4. When they finish, read every result. Check them; do not trust "done".
5. Put the pieces together yourself and check the whole.

Do not delegate a part that needs the user's answer, or a tiny step you can do faster yourself.`,
    },
    {
      name: 'writing-skills',
      description: 'Write or improve a Lotus skill: a short, reusable procedure with a clear trigger.',
      whenToUse: 'Write, create or improve a Lotus skill (a reusable procedure for later) and test that the skill works.',
      body: `# Writing skills

A skill is a short procedure Lotus loads when a request matches it (Assistant → Skills).

## Steps
1. Start from a real case: what went wrong or took long without the skill?
2. **Name**: two or three words, the subject first ("invoice-checking").
3. **Use when**: one sentence with the words a matching request would contain. Lotus picks a skill only when the request shares at least two of these words, so be specific.
4. **Body**: numbered steps, then pitfalls, then "check that it worked". Under 300 words. Plain words. One idea per line.
5. Test it: try two requests that should bring it in and one that should not. Change the "use when" until only the right ones match.

## Pitfalls
- Vague triggers ("help with things") match everything.
- Long essays: small models skip them. Use short steps.
- Never put passwords or personal data in a skill.`,
    },
  ],
};
