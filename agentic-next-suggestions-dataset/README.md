# Agentic next-suggestions dataset

Local export of human follow-up patterns from Spanner, Pi, Claude Code, and Codex traces.

## Files

- `dataset.jsonl` — private full-text examples; gitignored.
- `manifest.json` — counts and source-root summary; gitignored.
- `build_dataset.py` — stdlib-only extractor.

## JSONL schema

Each line is one example:

```json
{
  "id": "ex_...",
  "source": "spanner | pi | claude_code | codex",
  "source_file": "~/...jsonl",
  "conversation_id": "stable hash",
  "turn_index": 0,
  "current_user_message": "human message at this turn",
  "context_messages": [{ "role": "user|assistant", "text": "visible text before next user message" }],
  "next_user_message": "human message sent next",
  "context_truncated": false,
  "omitted_context_messages": 0,
  "context_char_trimmed": false
}
```

## Regenerate

```bash
python3 agentic-next-suggestions-dataset/build_dataset.py
```

The export intentionally skips Claude subagent/journal traces, tool-result-only user records, injected AGENTS prompts, interrupted-turn markers, and Codex apply-patch warnings; those are agent-generated, not your follow-up messages.
