// Documents: Lotus's own versions of the Word, Excel, PowerPoint and PDF skills. Written from scratch
// (the originals are proprietary). Lotus can READ these files (attachments and files.read use fflate
// and pdf.js) but cannot write binary Office files, so each skill makes the content in a format Lotus
// can save (.md, .csv, .html) and says how to turn it into the Office or PDF file.

import type { BuiltinPluginDef } from './types';

export const DOCUMENTS: BuiltinPluginDef = {
  id: 'builtin-documents',
  name: 'Documents',
  version: '1.0.0',
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
Lotus cannot save .docx directly. Write the document in Markdown and save it with artifact.write (e.g. report.md):
- # for the title, ## for sections, real lists and tables.
- Then tell the user: open the file in Word (or paste it), or use Save As → .docx. For exact styles, paste into their template.

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
Save a .csv with artifact.write (e.g. budget.csv):
- First row: column names. One row per record. No merged cells, no totals mixed into the data.
- Numbers without currency signs or thousands separators (1234.5), dates as YYYY-MM-DD.
- Quote cells that contain commas.
Tell the user to open it in Excel or Sheets and Save As .xlsx.

## Formulas
Write them for the user to paste, with the cell they go in: "In D2: =B2*C2, then fill down". Prefer simple SUM, AVERAGE, IF, XLOOKUP. Explain each in one line.

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
Lotus cannot save .pptx. Either:
- write the deck as Markdown (## per slide, bullets, then "Notes:") with artifact.write, for the user to paste into PowerPoint; or
- make a self-contained .html deck (one section per slide, big text, arrow keys to move) that can be shown full-screen or printed to PDF.`,
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
Write a clean, self-contained .html page with artifact.write (print-friendly: white background, no fixed headers), then tell the user to open it and Print → Save as PDF. For a document, Markdown opened in Word → Save as PDF also works.

## Merge, split, rotate, fill forms
Lotus cannot change PDF files. Give the user clear steps for a free tool they already have (the browser or Edge prints selected pages to PDF; Windows "Microsoft Print to PDF"), and for forms, list each field with the text to type in it.`,
    },
  ],
};
