# 001 - screen-map-filtering - Tasks

- [x] T001 [agent] [status:done] Collector reports the outermost feed/log ancestor, or an article, as containerRole/containerName
      covers: D1@1
      changes: src/browser/collector.ts (+14 -3), src/browser/test/collector.test.ts (+18 -0)
- [x] T002 [agent] [status:done] Add optional dynamicChildren to EntityPattern and screen-map.schema.json
      covers: D2@1
      changes: schemas/screen-map.schema.json (+1 -0), src/screens/screen-map.ts (+2 -0)
- [x] T003 [agent] [status:done] learnScreen folds every element inside feed/log/article into a dynamicChildren pattern
      covers: D2@1
      changes: src/screens/screen-learn.ts (+7 -2)
- [x] T004 [agent] [status:done] learnScreen drops content-named prose elements (5+ words, sentence-final punctuation)
      covers: D3@1
      changes: src/screens/screen-learn.ts (+9 -0)
- [x] T005 [agent] [status:done] learnScreen drops elements matching the transient-name blocklist (EN + ES, accent-folded)
      covers: D4@1
      changes: src/screens/screen-learn.ts (+12 -0)
- [x] T006 [agent] [status:done] mergeScreen merges patterns by id, dropping unseen ones only with prune
      covers: D6@1, D7@1
      changes: src/screens/screen-merge.ts (+27 -0)
- [x] T007 [agent] [status:done] Test: chat fixture with the issue #3 elements persists only patterns, no message/reaction/quote ids
      covers: R1@1, R2@1, R3@1, R5@1
      kind: test
      changes: checks/fixtures/chat.html (+29 -0), src/screens/test/screen-filtering.test.ts (+39 -0)
- [x] T008 [agent] [status:done] Test: live snapshot of the chat fixture still lists and resolves every excluded element
      covers: R4@1, D5@1
      kind: test
      changes: src/screens/test/screen-filtering.test.ts (+13 -0)
- [x] T009 [agent] [status:done] Test: chrome controls (Send, Attach file, Sign in, Search) are still persisted unchanged
      covers: R6@1
      kind: test
      changes: src/screens/test/screen-filtering.test.ts (+11 -0)
- [x] T010 [agent] [status:done] Test: re-learning an existing polluted screen keeps junk without prune and removes it with prune; new patterns are added
      covers: R5@1, R7@1
      kind: test
      changes: src/browser/test/collector.test.ts (+7 -6), src/screens/test/screen-filtering.test.ts (+16 -0)
- [x] T011 [agent] [status:done] Document persistence filtering rules and dynamicChildren in docs/screen-map.md
      covers: D2@1, D3@1, D4@1
      changes: docs/screen-map.md (+11 -1)
- [ ] T012 [human] [status:todo] Learn a real chat thread in a logged-in PWA and confirm screens.json holds no message content
      covers: R1@1, R3@1
