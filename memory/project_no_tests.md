---
name: project-no-tests
description: User does not want automated tests for the engrave_pattern_generator project
metadata:
  type: feedback
---

For the engrave_pattern_generator project, do not write automated tests (no Vitest, no test files).

**Why:** User explicitly stated "Pas besoin de tests" during the brainstorming phase. It's a small personal tool for laser engraving, not production code — testing overhead is not warranted.

**How to apply:** Skip any TDD step, do not scaffold test infrastructure, do not add test scripts to package.json. Validate work by running the dev server and using the UI manually instead.
