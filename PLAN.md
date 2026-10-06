# Spanner Go v0 plan

Build a local, terminal-first coding-agent harness in Go. Take the small composable tools and repeated tool-use loop from [`whip-v1`](https://github.com/context-labs/whip/tree/whip-v1), not its TUI/session/MCP/subagent platform.

## v0 contract

```text
spanner "fix the failing test"

user prompt → model → tool calls → tool results → model → final response
```

- Run only in the current working directory for a trusted local repository.
- Use one OpenAI-compatible endpoint, configured by `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`.
- Stop after a final text response, cancellation, API/tool error, or `--max-turns` (default: 10).
- Stream model text into the terminal; show tool activity and errors separately.

## Tools

Implement the four core file/code tools from Whip’s `internal/tools` package.

| Tool | Minimal behavior |
| --- | --- |
| `bash` | Run a command from the workspace; capture combined output; enforce a per-call timeout and output limit. |
| `read` | Read a UTF-8 file with 1-based line numbers, `offset`, and `limit`. |
| `write` | Create parent directories and replace one file’s full contents. |
| `edit` | Replace an exact unique string; fail when it is absent or ambiguous. |

Run tool calls sequentially in v0. Return tool failures to the model as tool results rather than aborting the whole turn. Keep a bounded output size so a command cannot consume the next request’s context.

## TUI

Use Bubble Tea, as Whip does, with only:

- `textarea` for one prompt composer
- `viewport` for the transcript
- `lipgloss` for restrained styling

The first screen has a scrolling transcript, one input, streamed assistant text, and compact tool rows. `Ctrl-C` cancels the active request/command; `Ctrl-D` exits. Do not copy Whip’s `internal/tui`: it is coupled to its configuration, session, command, and agent layers.

## Package shape

```text
cmd/spanner/main.go       CLI setup and process lifecycle
internal/llm/client.go    OpenAI-compatible streaming request/response types
internal/agent/agent.go   Conversation state and bounded tool-use loop
internal/tools/tools.go   Tool definitions and dispatch
internal/tui/tui.go       One Bubble Tea transcript/input model
```

Use the standard library except for Bubble Tea, Bubbles, and Lip Gloss. Keep the provider client direct over `net/http`; do not add an SDK or an abstraction for providers that do not yet exist.

## Delivery order

1. Create the Go module and a headless loop with a fake `httptest` provider.
2. Add `bash`, `read`, `write`, and `edit`, including output/turn limits and focused unit tests.
3. Add the OpenAI-compatible streaming client and env-based configuration.
4. Add the minimal Bubble Tea shell and connect stream/tool events to its transcript.
5. Add a README quickstart and manually run against a disposable repository.

## Done when

- `go test ./...` covers a model → tool call → tool result → final-answer cycle.
- `spanner "list this repository"` runs in the terminal with configured API credentials.
- The TUI renders text and tool activity without corrupting input.
- A cancelled command/request stops cleanly.
- No sessions, config files, provider catalog, MCP, subagents, browser automation, file locks, parallel tools, or compaction code exists in v0.

## Deliberate follow-ups

Add only after the v0 loop is reliable: session persistence, confirmation/permission UX, parallel independent tool calls with mutation locks, structured questions, model routing, LSP feedback, MCP, and subagents.
