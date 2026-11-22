// Documents: Lotus's own versions of the Word, Excel, PowerPoint and PDF skills. Written from scratch
// (the originals are proprietary). Lotus reads these files (attachments and files.read use fflate and
// pdf.js) and, since 0.21, writes real .docx, .xlsx and .pptx files: artifact.write builds them from
// Markdown or CSV (core/src/tools/office.ts). PDFs are still made by printing an .html page.

import type { BuiltinPluginDef } from './types';

export const DOCUMENTS: BuiltinPluginDef = {
  id: 'builtin-documents',
  name: 'Documents',
  version: '1.1.0',
  description: 'Read, write and fix Word documents, spreadsheets, slide decks and PDFs.',
  author: 'Lotus',
  defaultOn: true,
  credit: { by: 'Lotus', license: 'Original', note: 'Written for Lotus. Does the same jobs as Claude’s Word, Excel, PowerPoint and PDF skills, in Lotus’s own words.' },
  instructions: '',
  commands: [],
  skills: [
    {
      name: 'word-documents',
      description: 'Read, write or rework Word documents (.docx): letters, reports, CVs.',
      whenToUse: 'Read, write, edit or summarise a Word document (.docx, doc file): a letter, report, CV or contract in Word.',
      body: `# Word documents

## Reading
Attached or allowed .docx files are read as text (files.read). Headings, lists and tables come through; images and tracked changes do not. Say so if they matter.

## Writing
Save a real Word file with artifact.write, filename ending .docx (e.g. report.docx). The content is Markdown, and Lotus turns it into Word:
- # Title (once, at the top), ## sections, ### sub-sections.
- Paragraphs, - bullet lists and 1. numbered lists (indent two spaces for a sub-point), | tables | with a header row, > quotes, **bold**, *italic*, [links](https://…).
- Write the whole document; never a summary or "…".
Don't paste the document into your answer: the user opens it from the file card. In the answer, say what is in it in a sentence or two.
To change it later, artifact.read gives the Markdown back; save it again under the same name.

## Structure that works
Title · one-paragraph summary · sections with clear headings · short paragraphs · tables for comparisons · a closing with next steps or contact.

## Editing an existing document
Quote the passage, then give the replacement text, section by section, so the user can paste each change. Keep their wording where it was fine.`,
    },
    {
      name: 'spreadsheets',
      description: 'Read, build or clean spreadsheets (.xlsx, .csv): tables, budgets, formulas.',
      whenToUse: 'Read, create, clean or analyse a spreadsheet (Excel, .xlsx, .csv, table of data, budget, formulas).',
      body: `# Spreadsheets

## Reading
.xlsx, .ods and .csv files are read as text tables (files.read). Read the header row first; check the units and empty cells before doing maths.

## Making one
Save a real Excel file with artifact.write, filename ending .xlsx (e.g. budget.xlsx). The content is CSV:
- First row: column names (it becomes a bold, frozen header with filter buttons). One row per record.
- Numbers as 1234.5 (no thousands separators), money as $1200 or 1200€, percentages as 25%, dates as YYYY-MM-DD: Excel gets real numbers and dates.
- Quote cells that contain commas.
- More than one sheet: put a line "## Sheet name" before each sheet's rows.
Only make a .csv when the user asks for CSV.

## Formulas
Put them straight in the cells, starting with =: a Total row with =SUM(B2:B9), a column with =B2*C2 on each row. Excel works them out when the file opens. Prefer SUM, AVERAGE, IF, ROUND, XLOOKUP. Mention the key formulas in your answer in one line each.

## Cleaning data
List the problems first (duplicates, mixed formats, stray header rows, blanks), then give the cleaned table. Never drop rows silently: say how many and why.

Double-check every total you state.`,
    },
    {
      name: 'presentations',
      description: 'Plan and write slide decks (.pptx): outlines, slide text, speaker notes.',
      whenToUse: 'Make, outline or improve a slide deck or presentation (PowerPoint, .pptx, slides, pitch deck, speaker notes).',
      body: `# Presentations

## Reading
.pptx files are read as text, slide by slide (files.read). Pictures and layout are not seen.

## Planning
1. Who is the audience and what should they do after? One sentence.
2. Outline: title → the problem → the key message → 3–5 supporting points → ask / next steps.
3. One idea per slide. Slide title = the takeaway ("Costs fell 20%"), not a topic ("Costs").

## Slide text
At most 3–5 short bullets, about 6 words each. Details go in speaker notes. Suggest one visual per slide (chart, photo, diagram).

## Making the file
Save a real PowerPoint deck with artifact.write, filename ending .pptx (e.g. pitch.pptx). The content is Markdown:
- A line with only --- between slides.
- Each slide starts with # Slide title. The first slide is the title slide: # Title, then one line of subtitle.
- Bullets with -, a | table | if it helps, then a line "Notes:" followed by the speaker notes.
Lotus lays the slides out (16:9, title, accent line, bullets that shrink to fit). For a deck to show in the browser instead, make one self-contained .html file (one section per slide, arrow keys to move).`,
    },
    {
      name: 'pdf-files',
      description: 'Read, summarise or make PDFs; explain how to merge, split or fill them.',
      whenToUse: 'Read, summarise, extract from or make a PDF file (.pdf); merge, split, fill a PDF form.',
      body: `# PDF files

## Reading
Attached or allowed PDFs are read as text with pdf.js. Scanned PDFs (pictures of pages) have no text: say so and suggest running OCR, or attach the pages as images for a vision model.

## Summarising and extracting
Give page numbers for every fact you take from it. Tables may come out jumbled: rebuild them and say you did.

## Making a PDF
Write a clean, self-contained .html page with artifact.write (print-friendly: white background, no fixed headers), then tell the user to open it and Print → Save as PDF. A .docx made with artifact.write can also be saved as PDF from Word (File → Save As → PDF).

## Merge, split, rotate, fill forms
Lotus cannot change PDF files. Give the user clear steps for a free tool they already have (the browser or Edge prints selected pages to PDF; Windows "Microsoft Print to PDF"), and for forms, list each field with the text to type in it.`,
    },
  ],
};
