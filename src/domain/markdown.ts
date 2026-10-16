/** Pure Markdown heading-section parsing and text bounding. No I/O, no AI summarization. */

export interface MarkdownSection {
  name: string;
  body: string;
}

/**
 * Split markdown into the bodies of exact `#`.repeat(level) heading sections.
 * Deeper headings stay inside the section body; shallower or equal headings end it.
 */
export function parseSections(markdown: string, level = 2): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  const lines = markdown.split(/\r?\n/u);
  let current: MarkdownSection | null = null;

  const push = () => {
    if (current) {
      sections.push({ name: current.name, body: current.body.trimEnd() });
    }
    current = null;
  };

  for (const line of lines) {
    const heading = matchHeading(line, level);
    if (heading !== null) {
      push();
      current = { name: heading, body: "" };
      continue;
    }
    if (current) {
      if (isHeadingAtMost(line, level)) {
        push();
      } else {
        current.body += (current.body === "" ? "" : "\n") + line;
      }
    }
  }
  push();
  return sections;
}

export function findSection(markdown: string, name: string, level = 2): MarkdownSection | undefined {
  return parseSections(markdown, level).find((section) => section.name === name);
}

/** Extract a Markdown ordered-list body into its items; fall back to non-empty lines. */
export function parseNumberedList(body: string): string[] {
  const items: string[] = [];
  for (const line of body.split(/\r?\n/u)) {
    const match = /^\s*\d+\.\s+(.+?)\s*$/u.exec(line);
    if (match) {
      items.push(match[1]!);
    }
  }
  return items.length > 0
    ? items
    : body
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
}

/** Bound guidance to its leading `max` chars, preserving its intent and first rules. */
export function boundText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, max)}\n...[truncated after ${max} chars]`,
    truncated: true,
  };
}

function matchHeading(line: string, level: number): string | null {
  const prefix = "#".repeat(level) + " ";
  if (!line.startsWith(prefix)) {
    return null;
  }
  return line
    .slice(prefix.length)
    .trim()
    .replace(/\s+#+$/u, "")
    .trimEnd();
}

function isHeadingAtMost(line: string, level: number): boolean {
  const match = /^(#{1,})\s/u.exec(line);
  return match !== null && match[1]!.length <= level;
}
