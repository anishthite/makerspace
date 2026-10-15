package agent

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/anishthite/spanner-go/internal/llm"
)

// executeCalls joins each batch before returning; only its owner updates history.
// The executor argument lets tests verify scheduling without timing real disk I/O.
func executeCalls(ctx context.Context, root string, calls []llm.ToolCall, execute func(context.Context, string, string) string, emit func(Event)) []string {
	results := make([]string, len(calls))
	var events sync.Mutex
	send := func(e Event) {
		events.Lock()
		defer events.Unlock()
		if emit != nil {
			emit(e)
		}
	}
	run := func(i int) {
		tc := calls[i]
		if ctx.Err() != nil {
			results[i] = "Error: cancelled before execution"
			return
		}
		send(Event{Kind: "tool_start", ID: tc.ID, Name: tc.Function.Name, Text: tc.Function.Arguments})
		results[i] = execute(ctx, tc.Function.Name, tc.Function.Arguments)
		send(Event{Kind: "tool_end", ID: tc.ID, Name: tc.Function.Name, Text: results[i]})
	}
	for start := 0; start < len(calls); {
		// Re-resolve paths after every exclusive call: Bash can change symlinks.
		var paths []string
		end := start
		for end < len(calls) {
			path, ok := fileCallPath(root, calls[end])
			if !ok {
				break
			}
			paths = append(paths, path)
			end++
		}
		if end == start {
			run(start)
			start++
			continue
		}
		done := make([]chan struct{}, len(paths))
		infos := make([]os.FileInfo, len(paths))
		for i, path := range paths {
			done[i] = make(chan struct{})
			infos[i], _ = os.Stat(path)
		}
		var workers sync.WaitGroup
		for i, path := range paths {
			var dependencies []<-chan struct{}
			// ponytail: O(n²) conflict scan within one model batch; use keyed queues if large batches become material.
			for j := 0; j < i; j++ {
				sameFile := infos[i] != nil && infos[j] != nil && os.SameFile(infos[i], infos[j])
				if sameFile || path == paths[j] || strings.HasPrefix(path, paths[j]+string(os.PathSeparator)) || strings.HasPrefix(paths[j], path+string(os.PathSeparator)) {
					dependencies = append(dependencies, done[j])
				}
			}
			workers.Add(1)
			go func(i int, dependencies []<-chan struct{}) {
				defer workers.Done()
				defer close(done[i])
				for _, dependency := range dependencies {
					select {
					case <-dependency:
					case <-ctx.Done():
						results[start+i] = "Error: cancelled before execution"
						return
					}
				}
				run(start + i)
			}(i, dependencies)
		}
		workers.Wait()
		start = end
	}
	return results
}

func fileCallPath(root string, call llm.ToolCall) (string, bool) {
	switch call.Function.Name {
	case "read", "write", "edit":
	default:
		return "", false
	}
	var args struct {
		Path string `json:"path"`
	}
	if json.Unmarshal([]byte(call.Function.Arguments), &args) != nil || args.Path == "" {
		return "", false
	}
	path := args.Path
	if filepath.IsAbs(path) && (strings.Contains(path, string(os.PathSeparator)+".."+string(os.PathSeparator)) || strings.HasSuffix(path, string(os.PathSeparator)+"..")) {
		return "", false
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(root, path)
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return "", false
	}
	// Resolve the longest existing ancestor, including symlinked directories for new files.
	ancestor := path
	var suffix []string
	for {
		resolved, err := filepath.EvalSymlinks(ancestor)
		if err == nil {
			for i := len(suffix) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, suffix[i])
			}
			return resolved, true
		}
		if !os.IsNotExist(err) || filepath.Dir(ancestor) == ancestor {
			return "", false
		}
		if info, statErr := os.Lstat(ancestor); statErr == nil && info.Mode()&os.ModeSymlink != 0 {
			return "", false
		}
		suffix = append(suffix, filepath.Base(ancestor))
		ancestor = filepath.Dir(ancestor)
	}
}
