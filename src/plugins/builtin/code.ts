// Code quality: Lotus's own versions of the code-review, simplify and security-review skills, written
// from scratch. Lotus cannot run git, tests or linters, so the skills read the code with files.* and
// ask the user to run what Lotus cannot.

import type { BuiltinPluginDef } from './types';

export const CODE: BuiltinPluginDef = {
  id: 'builtin-code-quality',
  name: 'Code Quality',
  version: '1.0.0',
  description: 'Review code for bugs, simplify it, and check it for security problems.',
  author: 'Lotus',
  defaultOn: true,
  credit: { by: 'Lotus', license: 'Original', note: 'Written for Lotus. Does the same jobs as Claude’s code-review, simplify and security-review skills, in Lotus’s own words.' },
  instructions: '',
  commands: [
    { name: 'review', description: 'Review code for bugs', prompt: 'Review this code for bugs. List only real problems, most serious first, each with the line, what goes wrong and a fix:\n\n{{input}}' },
    { name: 'simplify', description: 'Make code simpler without changing what it does', prompt: 'Simplify this code without changing what it does: remove duplication and dead code, use clearer names, reuse what exists. Show the new code and list the changes:\n\n{{input}}' },
    { name: 'security-review', description: 'Check code for security problems', prompt: 'Check this code for security problems (injection, secrets, unsafe input, access control). For each: severity, where, how it could be abused, the fix:\n\n{{input}}' },
  ],
  skills: [
    {
      name: 'code-review',
      description: 'Review code changes for real bugs and risks.',
      whenToUse: 'Review code or a pull request (code review, PR, diff) for bugs, mistakes and missing tests.',
      body: `# Code review

1. Learn what the change is meant to do (ask, or read the description).
2. Read the changed code AND the code it calls or is called by (files.read, files.search).
3. Look for real problems:
   - wrong logic, off-by-one, wrong conditions
   - null / empty / missing values; errors not handled
   - inputs the code does not expect (very long, zero, negative, unicode)
   - race conditions, leaks, things left open
   - broken promises to callers (changed names, types, behaviour)
   - missing or weak tests for the new behaviour
4. For each finding: file and line, what goes wrong (a concrete example input), the fix.
5. Order: serious bugs first, then risks, then small nits (mark them as nits).

Only report what you can explain with a concrete case. "Looks fine" is a valid result.`,
    },
    {
      name: 'simplify-code',
      description: 'Make code simpler, shorter and clearer without changing its behaviour.',
      whenToUse: 'Simplify, clean up or refactor code: remove duplication and dead code, make code clearer and shorter.',
      body: `# Simplifying code

**Rule: behaviour stays exactly the same.**

Look for:
- duplicated code → one shared function (check one does not exist already with files.search)
- dead code, unused variables and imports
- deep nesting → early returns
- long functions → smaller ones with clear names
- clever one-liners → plain code
- comments that repeat the code → remove; comments that explain WHY → keep
- doing work twice (in loops, repeated reads) → do it once

Change one thing at a time. After the change, list what changed and why, and tell the user which tests to run to confirm nothing broke.`,
    },
    {
      name: 'security-review',
      description: 'Check code for security problems and how to fix them.',
      whenToUse: 'Security review or audit of code: vulnerabilities, injection, secrets, passwords, authentication, unsafe user input.',
      body: `# Security review

Check:
- **Injection**: user input in SQL, shell commands, HTML (XSS), file paths (../), eval. Fix with parameters, escaping, allow-lists.
- **Secrets**: keys, passwords or tokens in code or logs. Move them to settings or environment variables; rotate leaked ones.
- **Access**: every action checks who the user is and that they are allowed.
- **Input**: size limits, type checks, file upload type checks.
- **Data**: passwords hashed (bcrypt/argon2), HTTPS, no personal data in logs or URLs.
- **Dependencies**: very old or unmaintained packages.
- **Errors**: no stack traces or internals shown to users.

For each finding: severity (high / medium / low), file and line, how an attacker could use it, the fix. Report only real, explainable risks.`,
    },
  ],
};
