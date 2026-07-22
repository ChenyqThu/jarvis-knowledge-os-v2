import type { BrainScoreComponents } from '../types';

const COMPONENT_MAX: Record<keyof BrainScoreComponents, number> = {
  embed_coverage: 35,
  link_density: 25,
  timeline_coverage: 15,
  no_orphans: 15,
  no_dead_links: 10,
};

export interface DoctorSummary {
  fail: number;
  warn: number;
}

/** Health page "doctor 摘要" (design.md §5): design.md asks for fail/warn
 * counts, but prd.md's frozen API contract only adds `orphans_total` /
 * `chunkless_total` to /health — there is no dedicated doctor-check field.
 * Rather than invent one, this classifies each of the 5 already-frozen
 * brain_score components (from /overview, unchanged since M1) against the
 * dashboard's standard >=0.9 emerald / >=0.7 amber / else red thresholds
 * (the same bands used for every coverage badge) and counts how many land
 * in the warn/fail bands. See implement-frontend.md "assumptions". */
export function summarizeDoctor(components: BrainScoreComponents): DoctorSummary {
  let fail = 0;
  let warn = 0;
  (Object.keys(COMPONENT_MAX) as (keyof BrainScoreComponents)[]).forEach(key => {
    const ratio = components[key] / COMPONENT_MAX[key];
    if (ratio < 0.7) fail += 1;
    else if (ratio < 0.9) warn += 1;
  });
  return { fail, warn };
}
