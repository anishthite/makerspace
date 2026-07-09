---
name: spanner-implementation-notes
description: Keep concise append-only implementation notes for non-trivial Spanner changes. Use when implementing features, migrations, multi-file bug fixes, packaging changes, or remote/runtime behavior changes.
---

# Spanner Implementation Notes

Use this skill when a task is non-trivial or changes runtime/package/deploy behavior.

## Minimum workflow

1. Search `implementation-notes/` for related prior work.
2. Create `implementation-notes/YYYY-MM-DD-<slug>.html`.
3. Keep entries dense: tables over prose, one row per decision/tradeoff/file.
4. Record decisions as stable IDs: `D-*`, `T-*`, `A-*`, `R-*`, `L-*`.
5. Update `implementation-notes/INDEX.html` newest-first.
6. Mark the note `shipped` only after focused checks pass.

## Keep it small

- Do not restate the codebase.
- Do not add empty sections.
- Prefer one-line rows with paths, choices, and reversibility.
