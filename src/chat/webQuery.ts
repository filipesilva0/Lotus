// Search words from a chat message (pure; shared by Chat and the search planner).

/** A search query from a chat message: drops filler, keeps the question's words. */
export function queryFromMessage(text: string): string {
  let t = text.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
  const lead = /^(hey|hi|hello|please|can you|could you|would you|tell me|search( the web)?( for)?|look up|find( out)?)\b[\s,:]*/i;
  for (let i = 0; i < 5 && lead.test(t); i++) t = t.replace(lead, '');
  return t.slice(0, 200);
}
