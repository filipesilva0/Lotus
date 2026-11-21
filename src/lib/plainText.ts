// Markdown to one plain line, for titles and list rows (Activity showed "**Plan my week**" with the
// stars). Not a Markdown renderer: it only drops the marks people see as noise in a title.

export function plainLine(md: string, max = 200): string {
  let s = String(md ?? '');
  s = s.replace(/```[\s\S]*?```/g, ' ')                 // code blocks
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')           // images → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')            // links → their text
    .replace(/<\/?[a-z][^>]*>/gi, '')                   // html tags
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '') // headings, quotes, list marks
    .replace(/(\*\*|__)(.+?)\1/g, '$2')                 // bold
    .replace(/(^|[^\w*])([*_])(?!\s)(.+?)(?<!\s)\2(?!\w)/g, '$1$3') // italics
    .replace(/~~(.+?)~~/g, '$1')                        // strike
    .replace(/`([^`]+)`/g, '$1')                        // inline code
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
