# Spanner Go v0

A local, terminal-first coding agent: prompt → streaming model → tools → results → final answer.

## Quickstart

Requires Go 1.25+, Bash, and macOS or Linux. Run only in a **trusted local repository**: commands and file tools have your host permissions, with no sandbox or confirmation prompts.

Sign in to Codex with a ChatGPT account using a device code:

```sh
go build -o spanner ./cmd/spanner
./spanner login
```

Open the displayed `auth.openai.com` URL, enter the one-time code, and return to the terminal. Tokens are saved only in `~/.spanner/auth.json` with user-only permissions. This login does **not yet** replace the model runtime below: the current agent still uses its OpenAI-compatible API configuration.

```sh
go build -o spanner ./cmd/spanner
export OPENAI_API_KEY='your-key'
export OPENAI_MODEL='your-model'
# Optional; defaults to https://api.openai.com/v1
export OPENAI_BASE_URL='https://api.openai.com/v1'

# Start in the repository you want the agent to work on.
./spanner "list this repository"
# Or open an empty composer:
./spanner
```

`OPENAI_BASE_URL` is the API base, not the full `/chat/completions` URL. The provider must support OpenAI-compatible streaming chat completions and function tool calls.

## Controls

- Enter sends a prompt; Alt-Enter inserts a newline.
- PgUp/PgDn scroll the transcript.
- Ctrl-C cancels the active model request/command; when idle, clears the composer.
- Ctrl-D cancels active work, waits for it to stop, and exits.
- You can compose the next prompt while work runs; submit after completion.

For ordinary terminal output instead of the interactive screen:

```sh
./spanner --headless "list this repository"
```

Headless assistant text goes to stdout; tool activity and errors go to stderr.

## Limits and tools

Rounds are **uncapped by default**. An optional `--max-turns 20` allows 20 model/tool rounds, then one final request without tools to summarize progress. Cancel an unwanted loop with Ctrl-C.

| Tool | Behavior |
| --- | --- |
| `bash` | Bash in the startup working directory; combined stdout/stderr; default 30-second timeout, configurable per call from 1 to 300 seconds. |
| `read` | UTF-8 file, 1-based numbered lines; default offset 1 and limit 200. |
| `write` | Create parent directories and replace complete file contents. |
| `edit` | Replace one exact unique nonempty string; missing or ambiguous matches fail. |

Tool results are bounded to 32 KiB plus a truncation notice. Tool errors return to the model for recovery; API errors stop the run. Cancellation kills the command's Unix process group. File writes already completed are not rolled back.

Relative paths resolve against the startup directory; absolute paths are accepted. This is a workspace convention, **not access confinement**.

## Checks

```sh
go test ./...
go test -race ./...
go vet ./...
```

Tests use a fake `httptest` provider; no credentials are needed. Headless and interactive PTY smoke tests were also run against a fake provider in a disposable Git repository. Live-provider validation remains outstanding because API credentials were unavailable.

See [HARNESS.md](HARNESS.md) for the complete implemented harness sketch and [PLAN.md](PLAN.md) for scope. No sessions, compaction, retries, parallel tools, MCP, or subagents are included. Codex device authentication is available now; connecting those credentials to a Codex inference runtime is deliberately deferred.
