import matter from 'gray-matter';

// Vendored replica of gbrain's serializeMarkdown (src/core/markdown.ts:393)
// composed with serializePageToMarkdown (:662), from gbrain v0.42.63.0.
//
// REPLICATED, not imported: importing markdown.ts would make the dashboard's
// `tsc --noEmit` follow the import and typecheck the whole upstream engine
// graph (markdown.ts → sync.ts → engine → …), which does not compile under
// this package's config. The logic below is 8 lines and byte-identical to
// upstream; keep in sync on upstream bumps.
//
// Round-trip safety (design.md §1): put_page re-parses the content via
// parseMarkdown, and serializeMarkdown/splitBody are symmetric (the
// `<!-- timeline -->` marker). The DB stores type/title/tags/slug in their own
// columns (parseMarkdown strips them out of the frontmatter JSONB), so they
// MUST be folded back in here — otherwise a save would wipe them. Because
// put_page re-parses, semantic YAML equality is sufficient (no need to match
// byte-for-byte).

export interface PageRow {
  type: string;
  title: string;
  timeline: string;
  compiled_truth: string;
  frontmatter: Record<string, unknown>;
}

export function toEditableMarkdown(row: PageRow, tags: string[]): string {
  const fullFrontmatter: Record<string, unknown> = {
    type: row.type,
    title: row.title,
    ...row.frontmatter,
  };
  if (tags.length > 0) fullFrontmatter.tags = tags;

  const yamlContent = matter.stringify('', fullFrontmatter).trim();
  let body = row.compiled_truth;
  if (row.timeline) body += '\n\n<!-- timeline -->\n\n' + row.timeline;
  return yamlContent + '\n\n' + body + '\n';
}
