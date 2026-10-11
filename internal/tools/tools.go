// Package tools executes commands in a trusted local workspace, not a sandbox.
package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/anishthite/spanner-go/internal/llm"
)

const OutputLimit = 32 * 1024
const DefaultTimeout = 30 * time.Second

type Tools struct{ Root string }

func Definitions() []llm.Definition {
	schema := func(props map[string]any, required ...string) any {
		return map[string]any{"type": "object", "properties": props, "required": required, "additionalProperties": false}
	}
	str := map[string]any{"type": "string"}
	integer := map[string]any{"type": "integer", "minimum": 1}
	return []llm.Definition{
		{Type: "function", Function: llm.FunctionDefinition{Name: "bash", Description: "Run a shell command in the workspace; timeout seconds defaults to 30, maximum 300; output is bounded.", Parameters: schema(map[string]any{"command": str, "timeout": integer}, "command")}},
		{Type: "function", Function: llm.FunctionDefinition{Name: "read", Description: "Read a UTF-8 file with 1-based line numbers; offset defaults to 1 and limit to 200.", Parameters: schema(map[string]any{"path": str, "offset": integer, "limit": integer}, "path")}},
		{Type: "function", Function: llm.FunctionDefinition{Name: "write", Description: "Create parent directories and replace a file's complete contents.", Parameters: schema(map[string]any{"path": str, "content": str}, "path", "content")}},
		{Type: "function", Function: llm.FunctionDefinition{Name: "edit", Description: "Replace oldText with newText only when oldText occurs exactly once.", Parameters: schema(map[string]any{"path": str, "oldText": str, "newText": str}, "path", "oldText", "newText")}},
	}
}

func Bound(s string) string {
	s = strings.ToValidUTF8(s, "�")
	if len(s) <= OutputLimit {
		return s
	}
	n := OutputLimit
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n] + "\n[output truncated]"
}

func (t Tools) Execute(ctx context.Context, name, arguments string) string {
	out, err := t.execute(ctx, name, arguments)
	if err != nil {
		out = "Error: " + err.Error() + "\n" + out
	}
	return Bound(out)
}

func (t Tools) execute(ctx context.Context, name, arguments string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	var args struct {
		Path    string  `json:"path"`
		Content *string `json:"content"`
		OldText *string `json:"oldText"`
		NewText *string `json:"newText"`
		Command string  `json:"command"`
		Timeout *int    `json:"timeout"`
		Offset  *int    `json:"offset"`
		Limit   *int    `json:"limit"`
	}
	dec := json.NewDecoder(strings.NewReader(arguments))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&args); err != nil {
		return "", err
	}
	if name == "bash" {
		if strings.TrimSpace(args.Command) == "" {
			return "", fmt.Errorf("command is required")
		}
		timeout := DefaultTimeout
		if args.Timeout != nil {
			if *args.Timeout < 1 || *args.Timeout > 300 {
				return "", fmt.Errorf("timeout must be 1..300 seconds")
			}
			timeout = time.Duration(*args.Timeout) * time.Second
		}
		callCtx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		cmd := exec.CommandContext(callCtx, "bash", "-c", args.Command)
		cmd.Dir = t.Root
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
		cmd.WaitDelay = time.Second
		var output cappedBuffer
		cmd.Stdout = &output
		cmd.Stderr = &output
		err := cmd.Run()
		if callCtx.Err() != nil {
			err = callCtx.Err()
		}
		return output.String(), err
	}
	if args.Path == "" {
		return "", fmt.Errorf("path is required")
	}
	path := args.Path
	if !filepath.IsAbs(path) {
		path = filepath.Join(t.Root, path)
	}
	switch name {
	case "read":
		offset, limit := 1, 200
		if args.Offset != nil {
			offset = *args.Offset
		}
		if args.Limit != nil {
			limit = *args.Limit
		}
		if offset < 1 || limit < 1 {
			return "", fmt.Errorf("offset and limit must be positive")
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		if !utf8.Valid(b) {
			return "", fmt.Errorf("file is not UTF-8")
		}
		lines := strings.Split(strings.TrimSuffix(string(b), "\n"), "\n")
		if len(b) == 0 {
			return "", nil
		}
		var out strings.Builder
		for i := offset - 1; i < len(lines) && i-(offset-1) < limit; i++ {
			fmt.Fprintf(&out, "%d: %s\n", i+1, lines[i])
			if out.Len() > OutputLimit {
				return Bound(out.String()), nil
			}
		}
		if offset-1 < len(lines) && limit < len(lines)-(offset-1) {
			out.WriteString("[more lines available]\n")
		}
		return out.String(), nil
	case "write":
		if args.Content == nil {
			return "", fmt.Errorf("content is required")
		}
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return "", err
		}
		if err := os.WriteFile(path, []byte(*args.Content), 0644); err != nil {
			return "", err
		}
		return "Wrote " + args.Path, nil
	case "edit":
		if args.OldText == nil || *args.OldText == "" || args.NewText == nil {
			return "", fmt.Errorf("nonempty oldText and newText are required")
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		old := *args.OldText
		s := string(b)
		first := strings.Index(s, old)
		if first < 0 {
			return "", fmt.Errorf("oldText not found")
		}
		if strings.Contains(s[first+1:], old) {
			return "", fmt.Errorf("oldText is ambiguous")
		}
		info, err := os.Stat(path)
		if err != nil {
			return "", err
		}
		if err := os.WriteFile(path, []byte(strings.Replace(s, old, *args.NewText, 1)), info.Mode().Perm()); err != nil {
			return "", err
		}
		return "Edited " + args.Path, nil
	default:
		return "", fmt.Errorf("unknown tool %q", name)
	}
}

type cappedBuffer struct {
	mu        sync.Mutex
	b         bytes.Buffer
	truncated bool
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(p)
	remaining := OutputLimit - b.b.Len()
	if len(p) > remaining {
		p = p[:remaining]
		b.truncated = true
	}
	_, _ = b.b.Write(p)
	return n, nil
}
func (b *cappedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	s := b.b.String()
	if b.truncated {
		s += "\n[output truncated]"
	}
	return s
}
