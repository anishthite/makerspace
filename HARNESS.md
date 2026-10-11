# Spanner harness — implemented v0

## Entire runtime

```text
spanner [--headless] [--max-turns N] ["prompt"]
                 │
                 ▼
       cmd/spanner/main.go
       • parse flags and OPENAI_* environment
       • capture current working directory
       • create cancellation context and Agent
                 │
        ┌────────┴───────────────┐
        ▼                        ▼
 internal/tui/tui.go        headless callback
 Bubble Tea                assistant → stdout
 ┌────────────────────┐    tools/errors → stderr
 │ viewport transcript│          │
 │ textarea composer  │          │
 │ status / controls  │          │
 └─────────┬──────────┘          │
           └──────────┬─────────┘
                      ▼
            internal/agent/agent.go
            in-memory []llm.Message
                      │
               append user prompt
                      │
          ┌───────────▼──────────────────┐
          │ internal/llm/client.go       │
          │ POST /chat/completions       │
          │ stream=true                 │
          │ messages + tool definitions │
          └───────────┬──────────────────┘
                      │ SSE deltas
              ┌───────┴────────┐
              ▼                ▼
        text events      assemble tool calls
        → terminal       (fragmented arguments)
              └───────┬────────┘
                      ▼
             append assistant message
                      │
               any tool calls?
                │           │
               no          yes
                │           ▼
                │   internal/tools/tools.go
                │   parallel independent file calls
                │   ordered conflicts / exclusive Bash
                │   ┌──────────────────────┐
                │   │ bash read write edit │
                │   └──────────┬───────────┘
                │              │ bounded result / error
                │              ▼
                │      append tool messages
                │              │
                │              └──────→ next model request
                ▼
          return final response
          TUI ready for next prompt;
          headless process exits
```

## Package responsibilities

| File | Owns |
| --- | --- |
| `cmd/spanner/main.go` | CLI flags, required credentials/model, base URL validation, working directory, interrupt/termination signals, frontend selection. |
| `internal/llm/client.go` | Wire types, authenticated HTTP POST, bounded SSE event parsing, streamed text callback, tool delta assembly, HTTP/provider/truncated-stream errors. |
| `internal/agent/agent.go` | System prompt, conversation history, model/tool loop, ordered batch results, optional graceful cap, lifecycle events. |
| `internal/agent/parallel.go` | Batch-local dependency scheduling, file identity resolution, exclusive barriers, serialized call-ID events, worker joining. |
| `internal/tools/tools.go` | Four function schemas, argument validation, file operations, command timeout/process-group cancellation, bounded output. |
| `internal/tui/tui.go` | Textarea and viewport, transcript wrapping, tool rows, input keys, async event delivery, worker shutdown. |

Only Bubble Tea, Bubbles, and Lip Gloss are direct dependencies; provider HTTP, JSON, files, process execution, and cancellation use the Go standard library. Their transitive dependencies are recorded in `go.mod`/`go.sum`.

## Provider contract

```text
OPENAI_API_KEY  required; sent as Authorization: Bearer …
OPENAI_MODEL    required; sent as model
OPENAI_BASE_URL default https://api.openai.com/v1

POST {base}/chat/completions
{
  "model": "…",
  "messages": [system, user, assistant, tool, …],
  "tools": [bash, read, write, edit],
  "stream": true
}
```

Assistant tool calls carry `id`, `type: "function"`, and a function name/JSON argument string. Each tool result references the original ID through `tool_call_id`. Text and fragmented tool arguments are assembled from SSE `data:` events. An unfinished stream or unsupported finish reason is an error, not a successful final answer.

## Loop rules

1. Initialize the system message once; retain completed conversation messages in memory across interactive prompts.
2. Append the new user prompt.
3. Request a streamed assistant response with the four tool definitions.
4. Append the completed assistant message; return if it contains no tool calls.
5. Execute independent file calls concurrently, preserving conflicting call order and exclusive Bash barriers; emit serialized start/end events with call IDs, join workers, and append bounded results in original call order.
6. Repeat until final response, cancellation, or API error.

`--max-turns 0` means unlimited rounds. With a positive cap, after that many rounds the agent adds a temporary summary instruction and removes tools from one final request. This request does not execute tools, even if a provider incorrectly emits calls.

### Parallel scheduling

```text
model call order: write a → edit a → read b → bash test → read a
                   │          │       │          │         │
                   └─done────→│       │          │         │
                     independent read b overlaps │         │
                              └──join───────────→│         │
                                                 └─done───→│
```

File calls wait for earlier calls touching the same canonical path, existing hardlink identity, or ancestor/descendant path. Independent paths can overlap; even reads on the same file are serialized for a simple deterministic policy. Symlinked ancestors of new files are resolved. Unclassifiable paths (including dangling symlinks) and non-file calls run exclusively, so Bash never overlaps an agent file operation. Identities are resolved again after each barrier because shell commands can change links.

Dependencies exist only for the current batch; no persistent file-lock map is needed. The conflict scan is O(n²) in batch size. External processes and detached shell jobs are outside this scheduler's coordination.

Tool failures are ordinary tool results prefixed with `Error:`. They do not terminate the loop. Cancellation remains fatal to the active run, and waiting and unexecuted calls receive cancellation results so later interactive requests have valid conversation history. Partial assistant text from a failed stream can appear in the transcript but is not committed to history.

## Tool contracts

| Tool | Arguments | Execution |
| --- | --- | --- |
| `bash` | `command`, optional `timeout` in seconds | `bash -c` in captured workspace; timeout 30 by default, maximum 300; bounded combined output. |
| `read` | `path`, optional `offset`, `limit` | UTF-8 file; offset 1, limit 200 by default; numbered lines and explicit continuation/truncation notices. |
| `write` | `path`, `content` | Make parent directories, overwrite the complete file. Empty contents are valid. |
| `edit` | `path`, `oldText`, `newText` | Reject empty/missing/ambiguous old text, including overlapping matches; replace exactly once. Empty replacement is valid. |

All tool results have a 32 KiB content bound plus an explicit notice when truncated; errors are placed first so truncation cannot hide them. Bash capture discards excess output while draining the process pipes. Read currently loads the whole file before selecting lines; its result is bounded, not its file allocation.

## Events and UI ownership

```text
Agent owner + parallel file workers (callbacks serialized)
  ├─ text        → append streamed text
  ├─ separator   → separate text and tools
  ├─ tool_start  → compact name + call ID + arguments row
  └─ tool_end    → compact name + call ID + result/error row
         │
         ▼ buffered event channel
Bubble Tea Update (sole UI owner)
         │
         ├─ refresh wrapped viewport
         └─ preserve independent composer state

worker completion → doneMsg → ready / error / exit
```

Only one run executes at a time. Enter during a run does not submit a second request; typed text remains in the composer. PgUp/PgDn scroll; new output follows the transcript tail. No tool result text is inserted into the input.

## Cancellation and shutdown

```text
Ctrl-C / interrupt / termination
              │
              ▼ context cancellation
     ┌────────┴──────────────────┐
     ▼                           ▼
 HTTP request context      bash call context
 closes active stream      kill Unix process group
                           drain/wait for process
     └────────┬──────────────────┘
              ▼
         agent returns
              ▼
     TUI ready, or process exits
```

Ctrl-D cancels active work and waits for completion before exiting. Program teardown also cancels and joins the worker. macOS/Linux are supported; the process-group implementation is Unix-specific. File tools are synchronous and check cancellation before starting; a file operation already underway is not transactional or interruptible. Cancelled work is not rolled back.

## Trust boundary and omissions

This is a trusted local harness, **not a sandbox**. Relative file paths start at the captured workspace, but absolute paths and `..` are accepted. Bash has the user's host access and network access. Provider requests send conversation and tool outputs to the configured endpoint.

There are no sessions, config files, provider catalogs, SDKs, permission dialogs, MCP, subagents, browser tools, persistent file-lock registries, retries, repeated-call guards, or context compaction. Long uncapped runs can exhaust provider context or incur costs; cancel manually or opt into a cap.

## Validation performed

- `go test ./...`: streamed model → failing tool → tool result → final response, graceful cap, file operations, truncation/error visibility, HTTP errors, stream errors, command/HTTP cancellation, UI input preservation; independent-call overlap, ordered alias conflicts, exclusive barriers, ordered results, and cancellation joining.
- `go test -race ./...` and `go vet ./...`.
- Built CLI, then ran headless and 80×24 PTY interactive modes in a disposable Git repository against a local fake provider; executed `bash ls`, rendered its result and final text, and exited with Ctrl-D.
- Parallel-branch headless smoke against a fake provider in a disposable workspace: independent writes overlap, edit/read dependencies observe prior changes, model results stay ordered, and call IDs appear in tool rows.
- Live-provider validation remains pending: no configured API credentials were available.
