# 001 - screen-map-filtering - Tasks

- [ ] T001 [agent] [status:todo] Collector reports the outermost feed/log ancestor, or an article, as containerRole/containerName
      covers: D1@1
- [ ] T002 [agent] [status:todo] Add optional dynamicChildren to EntityPattern and screen-map.schema.json
      covers: D2@1
- [ ] T003 [agent] [status:todo] learnScreen folds every element inside feed/log/article into a dynamicChildren pattern
      covers: D2@1
- [ ] T004 [agent] [status:todo] learnScreen drops content-named prose elements (5+ words, sentence-final punctuation)
      covers: D3@1
- [ ] T005 [agent] [status:todo] learnScreen drops elements matching the transient-name blocklist (EN + ES, accent-folded)
      covers: D4@1
- [ ] T006 [agent] [status:todo] mergeScreen merges patterns by id, dropping unseen ones only with prune
      covers: D6@1, D7@1
- [ ] T007 [agent] [status:todo] Test: chat fixture with the issue #3 elements persists only patterns, no message/reaction/quote ids
      covers: R1@1, R2@1, R3@1, R5@1
      kind: test
- [ ] T008 [agent] [status:todo] Test: live snapshot of the chat fixture still lists and resolves every excluded element
      covers: R4@1, D5@1
      kind: test
- [ ] T009 [agent] [status:todo] Test: chrome controls (Send, Attach file, Sign in, Search) are still persisted unchanged
      covers: R6@1
      kind: test
- [ ] T010 [agent] [status:todo] Test: re-learning an existing polluted screen keeps junk without prune and removes it with prune; new patterns are added
      covers: R5@1, R7@1
      kind: test
- [ ] T011 [agent] [status:todo] Document persistence filtering rules and dynamicChildren in docs/screen-map.md
      covers: D2@1, D3@1, D4@1
- [ ] T012 [human] [status:todo] Learn a real chat thread in a logged-in PWA and confirm screens.json holds no message content
      covers: R1@1, R3@1
