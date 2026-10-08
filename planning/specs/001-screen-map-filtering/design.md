# 001 - screen-map-filtering - Design

## Approach

- D1@1 (implements R1, R5): The collector's `containerOf` first looks for the outermost `[role="feed"]` or `[role="log"]` ancestor and reports it as the container; failing that, it also recognises `article` (tag or role) next to the existing list/grid/region roles. Reporting the outer stream - not each message - gives every item the same container key. _(standard: WAI-ARIA 1.2 `feed`, `log`, `article` roles - https://www.w3.org/TR/wai-aria-1.2/#feed)_
- D2@1 (implements R1, R5): `learnScreen` treats `feed`, `log` and `article` as dynamic container roles: every element inside one goes into a pattern (even a single element), gets no field/action/link entry, and the pattern carries `dynamicChildren: true`. `EntityPattern` and `schemas/screen-map.schema.json` gain the optional boolean `dynamicChildren`. _(judgement, no standard)_
- D3@1 (implements R2): `learnScreen` drops an element when `nameSource === "content"` and its name has at least 5 words and ends in `.`, `!`, `?` or `…`. Labels, aria-labels, titles and placeholders are never judged as prose. _(judgement, no standard)_
- D4@1 (implements R3): `learnScreen` drops an element whose name matches one case-insensitive, accent-folded blocklist constant: names starting with `reaction`, `view reactions`, `quoted message`, `reaccion`, `ver reacciones` or `mensaje citado`. _(judgement, no standard)_
- D5@1 (implements R4): All filtering lives in `learnScreen` - the single persistence path used by `src/tools/learn.ts` and the auto-learn in `src/ops/ops.ts`. The collector output, snapshot file, ref store and `pwa_find` are untouched, apart from the extra container roles in D1.
- D6@1 (implements R5): `mergeScreen` merges `patterns` by id: learned patterns replace existing ones with the same id, new ones are added, and existing ones not seen again are dropped only with `prune`.
- D7@1 (implements R7): No new cleanup step; previously persisted content entries leave through `mergeScreen`'s existing `prune` path, because they're no longer learned.

## Deliverables

- `src/browser/collector.ts` - dynamic container detection (D1).
- `src/screens/screen-map.ts`, `schemas/screen-map.schema.json` - `dynamicChildren` (D2).
- `src/screens/screen-learn.ts` - dynamic patterns, prose and blocklist filters (D2-D4).
- `src/screens/screen-merge.ts` - pattern merge (D6).
- Tests beside each unit; `docs/screen-map.md` documents the persistence rules.

## Sequencing

D1 before D2 (learn relies on the container roles). The schema change ships with D2 so maps that use `dynamicChildren` still validate. D6 is independent.
