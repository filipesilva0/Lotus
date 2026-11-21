// Search words from a chat message (pure; shared by Chat and the search planner).

/**
 * 0.20.0: Markdown never goes to a search engine. The 0.19 review saw a whole message, `**bold**`
 * and all, sent as the query (and 0 results).
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/[*>`~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A search query from a chat message: drops Markdown and filler, keeps the question's words. */
export function queryFromMessage(text: string): string {
  let t = stripMarkdown(text);
  const lead = /^(hey|hi|hello|please|can you|could you|would you|tell me|search( the web)?( for)?|look up|find( out)?)\b[\s,:!]*/i;
  for (let i = 0; i < 5 && lead.test(t); i++) t = t.replace(lead, '');
  return t.slice(0, 200);
}
