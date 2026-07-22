// Fence detection for the editor's hard gate (design.md §4).
//
// Remote MCP reads strip takes/facts fences (src/core/operations.ts:729 for
// get_page, :2542 for get_versions), so an edit round-trip that read a fenced
// page through MCP and wrote it back would PERMANENTLY drop the page's
// takes/facts tables. The editor therefore (a) reads the STORED, un-stripped
// compiled_truth via the RO SQL role, and (b) refuses to edit any page that
// carries a fence. Only fence-free pages are editable (MVP whitelist).
//
// Markers are verbatim from src/core/takes-fence.ts:106 and
// src/core/facts-fence.ts:53. Whole-brain count at build time: exactly 1
// fenced page (in gbrain-docs) — the gate is cheap insurance, not a blocker.
export const TAKES_FENCE_BEGIN = '<!--- gbrain:takes:begin -->';
export const FACTS_FENCE_BEGIN = '<!--- gbrain:facts:begin -->';

/** Returns the fence categories present in a page body (empty = editable). */
export function detectFences(compiledTruth: string): string[] {
  const found: string[] = [];
  if (compiledTruth.includes(TAKES_FENCE_BEGIN)) found.push('takes');
  if (compiledTruth.includes(FACTS_FENCE_BEGIN)) found.push('facts');
  return found;
}
