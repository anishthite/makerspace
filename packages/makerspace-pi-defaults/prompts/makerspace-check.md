---
description: Run the smallest relevant Makerspace check for the current change
argument-hint: "[focus]"
---
Run the smallest relevant check for this Makerspace change.

Focus area: ${1:-general change} ${@:2}.

Prefer one focused command first, then broader tests only if the change touches shared runtime, packaging, or UI build behavior. Report the exact command and result.
