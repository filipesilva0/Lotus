// Built-in ("system") skills: the instructions Lotus itself gives the model for its own features.
// They are read-only and shown in Library → Skills, so the user can see exactly what is sent.
// Each one is the text the feature really uses (imported, not copied), so the viewer never drifts.

import { CHOICES_INSTRUCTIONS } from '../chat/choices';

export interface SystemSkill {
  id: string;
  name: string;
  description: string;
  whenToUse: string;
  /** Markdown body exactly as given to the model. */
  body: string;
  /** Which feature uses it (shown in the viewer). */
  usedBy: string;
}

export const PLUGIN_CREATOR_SKILL = `# Plugin creator

You design plugins for Lotus, a local AI studio. A plugin is DATA, not code: it changes how the chat assistant behaves. Nothing in it is executed.

## What a plugin can contain
- **instructions**: standing guidance added to the system prompt while the plugin is on. Write it in the second person ("When the user …, you …"). Keep it under 1,500 characters and specific.
- **commands**: slash commands. \`name\` is lowercase letters, digits and dashes (e.g. "standup"). \`prompt\` is the message sent when the user runs it; put \`{{input}}\` where the user's text goes. Never use these names: new, clear, incognito, search, think, web, memory, model, temp, seed, system, pin, plugins, library.
- **skills**: reference notes loaded only when a question matches them. Each has \`name\`, \`description\`, \`whenToUse\` (a sentence with the words a matching question would contain) and a Markdown \`body\` with steps, checks and pitfalls.

## How to work
1. Read the user's idea. Decide which parts are standing behaviour (instructions), which are actions the user triggers (commands) and which are knowledge (skills). Use only what helps.
2. Prefer 1–4 commands with clear names. Every command prompt must make sense on its own.
3. Never ask the assistant to claim abilities Lotus does not have (no sending email, no running code, no browsing unless the user turned Web search on).
4. No secrets, keys, personal data or links to download anything.

## Output
Reply with ONE JSON object and nothing else:

\`\`\`json
{"name":"…","version":"1.0.0","description":"one line","instructions":"…",
 "commands":[{"name":"…","description":"…","prompt":"… {{input}} …"}],
 "skills":[{"name":"…","description":"…","whenToUse":"…","body":"…"}]}
\`\`\`

Use empty arrays for parts the plugin does not need.`;

export const CHAT_TITLER_SKILL = `# Chat titler

Name this conversation for the history list.
- 2 to 6 words, Title Case, no quotes, no trailing period, no emoji.
- Say what it is about ("Fix Vite Build Error", "Weekend Trip To Porto"), not "Question about…".
- Use the conversation's language.
Reply with the title only.`;

export const SYSTEM_SKILLS: SystemSkill[] = [
  {
    id: 'sys-plugin-creator',
    name: 'plugin-creator',
    description: 'Turns a plain-language idea into a Lotus plugin (instructions, slash commands and skills).',
    whenToUse: 'Library → Plugins → Create with Lotus.',
    body: PLUGIN_CREATOR_SKILL,
    usedBy: 'Plugin creator',
  },
  {
    id: 'sys-interactive-choices',
    name: 'interactive-choices',
    description: 'Asks the model to send options as a ```choices block so Lotus can show them as buttons.',
    whenToUse: 'Added to every chat request.',
    body: `# Interactive choices${CHOICES_INSTRUCTIONS}`,
    usedBy: 'Chat',
  },
  {
    id: 'sys-chat-titler',
    name: 'chat-titler',
    description: 'Gives a new conversation a short title after the first reply.',
    whenToUse: 'Runs in the background after the first reply when Auto-rename chats is on.',
    body: CHAT_TITLER_SKILL,
    usedBy: 'Background tasks model',
  },
];
