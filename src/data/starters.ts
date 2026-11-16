// Ready-made prompts for empty Chat, Work and Images pages (0.9.6). Each one is complete: it gives the
// model a role, the task, how to answer, and leaves a clear place ([…]) for the user's own details.
// A click fills the message box; nothing is sent until the user presses Send.

export interface Starter { title: string; text: string }
export interface StarterGroup { id: string; label: string; items: Starter[] }

export const CHAT_STARTERS: StarterGroup[] = [
  { id: 'write', label: 'Write', items: [
    { title: 'Professional Email', text: 'Act as an experienced executive assistant. Write a clear, polite and concise email for the situation below. Give it a subject line, keep it under 150 words, and end with one specific next step. Then offer a shorter, more casual version.\n\nSituation: [who it is for, what you need, any deadline]' },
    { title: 'Editor', text: 'Act as a professional copy editor. Improve the text below for clarity, grammar and flow without changing its meaning or my voice. First give the edited text, then a short list of the most important changes and why.\n\nText:\n[paste your text]' },
    { title: 'Cover Letter', text: 'Act as a career coach who has read thousands of hiring files. Write a one-page cover letter for the job below, based on my background. Open with a specific hook, connect two or three of my achievements to what the job asks for, and avoid clichés.\n\nJob: [title, company, key requirements]\nMy background: [experience, skills, results]' },
    { title: 'Social Media Post', text: 'Act as a social media manager. Write three versions of a post about the topic below for [LinkedIn / Instagram / X]: one informative, one personal, one punchy. Each with a strong first line and a call to action; suggest up to three hashtags.\n\nTopic: [what it is about]' },
  ] },
  { id: 'learn', label: 'Learn', items: [
    { title: 'Patient Tutor', text: 'Act as a patient tutor. Teach me the topic below step by step, starting from what a beginner knows. Use one everyday analogy and one worked example. After each part, ask me one short question to check I understood before moving on.\n\nTopic: [what you want to learn]' },
    { title: 'Explain Like I’m 12', text: 'Act as a science communicator. Explain the idea below so a curious 12-year-old would understand it: short sentences, no jargon (or explain it when you must), one vivid example. Finish with three facts that would surprise them.\n\nIdea: [concept]' },
    { title: 'Study Plan and Quiz', text: 'Act as an exam coach. From the material below, make (1) a one-page summary of what matters most, (2) ten quiz questions from easy to hard, with the answers at the end, and (3) the three mistakes students make most often on this topic.\n\nMaterial:\n[paste notes or name the subject and level]' },
    { title: 'Debate Partner', text: 'Act as a fair debate partner. I will state a position. Give the three strongest arguments for it, the three strongest against it, and the evidence each side relies on. Then ask me which argument I find weakest and why.\n\nPosition: [your claim]' },
  ] },
  { id: 'code', label: 'Code', items: [
    { title: 'Senior Code Reviewer', text: 'Act as a senior software engineer doing a code review. Review the code below for bugs, edge cases, security issues, readability and performance. List the problems from most to least serious, each with the line, why it matters and a corrected snippet.\n\n```\n[paste code]\n```' },
    { title: 'Debugging Partner', text: 'Act as a debugging expert. Here is my error and the code around it. Explain in plain words what the error means, the most likely cause, how to confirm it, and the fix. If more than one cause is possible, rank them.\n\nError:\n[paste the error]\n\nCode:\n```\n[paste code]\n```' },
    { title: 'Write a Script', text: 'Act as an automation engineer. Write a well-commented [Python / PowerShell / Bash] script that does the following. Handle errors, explain how to run it, and list anything I must install first.\n\nTask: [what it should do, inputs and outputs]' },
    { title: 'Regex and SQL Helper', text: 'Act as a database and text-processing expert. Write the [regular expression / SQL query] for the need below, explain each part, and give three test cases that should match and two that should not.\n\nNeed: [describe it, with an example of the data]' },
  ] },
  { id: 'plan', label: 'Plan', items: [
    { title: 'Project Manager', text: 'Act as an experienced project manager. Turn the goal below into a plan: milestones, tasks with rough durations, dependencies, risks with how to reduce them, and what “done” looks like. Present it as a table, then a one-paragraph summary.\n\nGoal: [what, by when, who is involved]' },
    { title: 'Travel Planner', text: 'Act as a local travel expert. Plan a [number]-day trip to [place] for [who is travelling] with a [budget] budget. Day by day: morning, afternoon, evening, with travel times between places, one food recommendation per day and one tip locals know.' },
    { title: 'Decision Helper', text: 'Act as a decision coach. Help me choose between the options below. Ask me up to three questions about what matters most to me, then compare the options in a table against those criteria, and give a clear recommendation with the main risk of choosing it.\n\nOptions: [option A, option B, …]' },
    { title: 'Weekly Meal Plan', text: 'Act as a nutritionist and home cook. Make a 7-day meal plan for [number of people] with [preferences or restrictions], using simple recipes under 30 minutes. Then give one shopping list grouped by supermarket aisle.' },
  ] },
  { id: 'health', label: 'Health', items: [
    { title: 'Physiotherapy Explainer', text: 'Act as an experienced physiotherapist explaining to a patient. Explain the condition below in plain language: what is happening in the body, what usually helps, what to avoid, and the warning signs that mean seeing a professional quickly. Make clear this is general information, not a diagnosis.\n\nCondition: [condition or symptom]' },
    { title: 'Evidence Summary', text: 'Act as a clinical researcher. Summarise what the evidence says about the question below: the main findings, how strong the evidence is (study types and sizes), where studies disagree, and what is still unknown. Say clearly when you are unsure, and suggest search terms for PubMed.\n\nQuestion: [clinical question]' },
    { title: 'Exercise Programme', text: 'Act as a strength and conditioning coach. Design a [number]-week programme for [goal] for someone who [level, equipment, days per week, any limitations]. Give each session as a table (exercise, sets, reps, rest), how to progress each week, and how to tell if it is too much.' },
  ] },
];

export const WORK_STARTERS: StarterGroup[] = [
  { id: 'research', label: 'Research', items: [
    { title: 'Comparison Table', text: 'Act as a product researcher. Research the best [type of product] for [who it is for] under [budget]. Compare at least five options in a table (price, key specs, strengths, weaknesses, best for) and finish with a one-paragraph recommendation. Save it as a document.' },
    { title: 'Market Overview', text: 'Act as a market analyst. Write a short report on the [industry or product] market: who the main players are, trends from the last two years, customer needs that aren’t met, and three opportunities for a newcomer. Use the web, cite your sources, and save it as a document.' },
    { title: 'Literature Brief', text: 'Act as a research assistant. Find recent, reliable sources on [topic], read them, and write a two-page brief: background, what the evidence says, open questions, and a reference list. Save it as a document.' },
  ] },
  { id: 'create', label: 'Create', items: [
    { title: 'Landing Page', text: 'Act as a web designer and copywriter. Build a one-page website for [business or project]: a strong headline, what it offers, three benefits, testimonials placeholder, prices or opening hours, and a contact section. Clean, modern, works on phones. Save it as a page.' },
    { title: 'Presentation Outline', text: 'Act as a presentation coach. Create a [number]-slide presentation outline on [topic] for [audience]: each slide with a title, three short bullet points and speaker notes. Save it as a document.' },
    { title: 'Budget Spreadsheet', text: 'Act as a personal finance planner. Make a monthly budget table for [situation] with income, fixed costs, variable costs and savings, using realistic example numbers I can change, plus totals. Save it as a table.' },
  ] },
  { id: 'files', label: 'My Files', items: [
    { title: 'Summarise a Folder', text: 'Act as an analyst. Read the files in the attached folder and write a summary: what each file is, the main points across them, anything that contradicts itself, and what is missing. Save it as a document.' },
    { title: 'Tidy a Document', text: 'Act as an editor. Take the attached document, fix grammar and structure, add clear headings, and write a short summary at the top. Keep my meaning. Save the cleaned version as a new document.' },
    { title: 'Data to Insights', text: 'Act as a data analyst. Read the attached CSV or spreadsheet, describe what the data contains, find the three most interesting patterns, and make a summary table. Save the findings as a document.' },
  ] },
];

export const IMAGE_STARTERS: StarterGroup[] = [
  { id: 'photo', label: 'Photo', items: [
    { title: 'Portrait', text: 'Close-up portrait of an elderly fisherman with a weathered face and a knitted cap, soft window light from the left, shallow depth of field, 85mm lens, natural skin texture, muted colours, photorealistic' },
    { title: 'Product Shot', text: 'Studio product photo of a [product] on a matte stone pedestal, soft diffused lighting, gentle shadow, pastel background, centred composition, sharp focus, commercial photography' },
    { title: 'Landscape', text: 'Misty mountain valley at sunrise, a winding river catching golden light, pine forest in the foreground, dramatic clouds, wide-angle landscape photography, high detail' },
    { title: 'Food', text: 'Overhead photo of a rustic Portuguese breakfast table: pastéis de nata, fresh bread, coffee, oranges, linen cloth, morning sunlight, food photography, appetising, crisp detail' },
  ] },
  { id: 'art', label: 'Art', items: [
    { title: 'Watercolour', text: 'Watercolour painting of a narrow Lisbon street with a yellow tram, loose brushstrokes, soft bleeding colours, white paper showing through, warm afternoon light' },
    { title: 'Concept Art', text: 'Concept art of a floating city above the clouds, brass and glass architecture, airships docking, epic scale, cinematic lighting, highly detailed digital painting' },
    { title: 'Oil Painting', text: 'Impressionist oil painting of a sunflower field under a stormy sky, thick visible brushstrokes, vibrant yellows against deep blue, in the style of late 19th-century impressionism' },
    { title: 'Ink Illustration', text: 'Black ink illustration of an owl perched on an old book, fine cross-hatching, detailed feathers, white background, vintage engraving style' },
  ] },
  { id: 'design', label: 'Design', items: [
    { title: 'App Icon', text: 'App icon of a [subject], simple bold shape, flat vector style, soft gradient background, rounded square, centred, minimal, no text' },
    { title: 'Poster', text: 'Minimalist poster for a jazz night, a saxophone silhouette made of flowing lines, deep navy and gold, lots of negative space, mid-century modern design' },
    { title: 'Pattern', text: 'Seamless repeating pattern of tropical leaves and small birds, flat colours, teal, coral and cream palette, textile design' },
    { title: 'Isometric Scene', text: 'Isometric 3D illustration of a cosy home office with plants, a desk, a laptop and bookshelves, soft pastel colours, clean shapes, gentle lighting, game asset style' },
  ] },
  { id: 'character', label: 'Characters', items: [
    { title: 'Fantasy Hero', text: 'Full-body character design of a young fantasy ranger with a green cloak and a longbow, standing on a mossy rock, detailed costume, dynamic pose, painterly style, soft rim light' },
    { title: 'Cute Mascot', text: 'Cute round mascot character of a [animal] with big eyes and a small smile, simple shapes, soft 3D render, pastel colours, white background' },
    { title: 'Sci-fi Pilot', text: 'Portrait of a sci-fi pilot in a worn flight suit with glowing helmet visor reflections, cockpit lights, cinematic, detailed, moody colour grading' },
  ] },
];
