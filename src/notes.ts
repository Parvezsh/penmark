// The notes file sent to Claude: every pending comment, grouped by doc. No vscode import.
import { ReviewComment } from './comments';

const pad = (n: number) => String(n).padStart(2, '0');

export function notesFileName(now: Date): string {
  return `review-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.md`;
}

const localStamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * @param where  current line range of each comment (it may have moved since it was made)
 * @param rel    path of a doc as Claude should see it (relative to its working folder)
 */
export function formatNotes(
  comments: ReviewComment[],
  where: (c: ReviewComment) => { line: number; endLine: number },
  rel: (absPath: string) => string,
  now: Date,
): string {
  const byDoc = new Map<string, ReviewComment[]>();
  for (const c of comments) byDoc.set(c.path, [...(byDoc.get(c.path) ?? []), c]);
  const out = [
    `# Review comments (${localStamp(now)})`,
    '',
    'Please address each comment below by editing the doc in place. Each comment quotes the text it is about; line numbers are 1-based and approximate. If a comment is unclear, ask before changing anything.',
  ];
  for (const [doc, list] of byDoc) {
    out.push('', `## ${rel(doc)}`);
    const sorted = [...list].sort((a, b) => where(a).line - where(b).line);
    sorted.forEach((c, i) => {
      const w = where(c);
      const lines = w.endLine > w.line ? `Lines ${w.line + 1}-${w.endLine + 1}` : `Line ${w.line + 1}`;
      const quote = clip(c.quote.replace(/\s+/g, ' ').trim(), 400);
      out.push('', `${i + 1}. **${lines}**`, `   > ${quote}`, '', `   ${c.body.trim().replace(/\n/g, '\n   ')}`);
    });
  }
  return out.join('\n') + '\n';
}
