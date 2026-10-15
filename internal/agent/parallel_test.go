package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/anishthite/spanner-go/internal/llm"
	"github.com/anishthite/spanner-go/internal/tools"
)

func fileCall(id, name, path string) llm.ToolCall {
	args, _ := json.Marshal(map[string]string{"path": path, "tag": id})
	return llm.ToolCall{ID: id, Type: "function", Function: llm.Function{Name: name, Arguments: string(args)}}
}
func tag(arguments string) string {
	var args struct {
		Tag string `json:"tag"`
	}
	_ = json.Unmarshal([]byte(arguments), &args)
	return args.Tag
}
func receive[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case value := <-ch:
		return value
	case <-time.After(3 * time.Second):
		t.Fatal("scheduler did not finish")
		var zero T
		return zero
	}
}

func TestIndependentCallsOverlapAndEventsAreSerialized(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan string, 2)
	release := make(chan struct{})
	result := make(chan []string, 1)
	var events []Event // Deliberately unlocked: the scheduler must serialize callbacks.
	go func() {
		result <- executeCalls(ctx, t.TempDir(), []llm.ToolCall{fileCall("a", "read", "a"), fileCall("b", "write", "b")}, func(ctx context.Context, name, args string) string {
			id := tag(args)
			started <- id
			select {
			case <-release:
			case <-ctx.Done():
			}
			return id
		}, func(e Event) { events = append(events, e) })
	}()
	a, b := receive(t, started), receive(t, started)
	if a == b {
		t.Fatal("same call started twice")
	}
	close(release)
	results := receive(t, result)
	if fmt.Sprint(results) != "[a b]" {
		t.Fatal(results)
	}
	counts := map[string]int{}
	for _, e := range events {
		counts[e.ID]++
	}
	if counts["a"] != 2 || counts["b"] != 2 {
		t.Fatal(events)
	}
}

func TestConflictingAliasesKeepModelOrder(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a"), []byte("a"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("a", filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(filepath.Join(root, "a"), filepath.Join(root, "hard")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "dir"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("dir", filepath.Join(root, "dirlink")); err != nil {
		t.Fatal(err)
	}
	for _, paths := range [][]string{{"a", "./a", filepath.Join(root, "a")}, {"a", "link", "hard"}, {"dir/new", "dirlink/new", "dir/./new"}, {"newdir", "newdir/a", "newdir/a/b"}} {
		calls := []llm.ToolCall{fileCall("0", "write", paths[0]), fileCall("1", "edit", paths[1]), fileCall("2", "read", paths[2])}
		var order []string
		executeCalls(context.Background(), root, calls, func(_ context.Context, _, args string) string { order = append(order, tag(args)); return "ok" }, nil)
		if strings.Join(order, "") != "012" {
			t.Fatal(paths, order)
		}
	}
}

func TestExclusiveCallsAreBarriers(t *testing.T) {
	root := t.TempDir()
	calls := []llm.ToolCall{fileCall("0", "write", "a"), fileCall("1", "bash", "unused"), fileCall("2", "read", "a")}
	var order []string
	executeCalls(context.Background(), root, calls, func(_ context.Context, _, args string) string { order = append(order, tag(args)); return "ok" }, nil)
	if strings.Join(order, "") != "012" {
		t.Fatal(order)
	}
	// A dangling symlink is unclassifiable and must be exclusive.
	if err := os.Symlink("missing", filepath.Join(root, "dangling")); err != nil {
		t.Fatal(err)
	}
	if _, ok := fileCallPath(root, fileCall("x", "write", "dangling")); ok {
		t.Fatal("dangling symlink was classified as independent")
	}
}

func TestCancellationJoinsActiveAndSkipsWaitingCalls(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan string, 3)
	results := make(chan []string, 1)
	calls := []llm.ToolCall{fileCall("a", "write", "same"), fileCall("b", "edit", "same"), fileCall("c", "read", "other")}
	go func() {
		results <- executeCalls(ctx, t.TempDir(), calls, func(ctx context.Context, _, args string) string {
			started <- tag(args)
			<-ctx.Done()
			return "Error: cancelled during execution"
		}, nil)
	}()
	first, second := receive(t, started), receive(t, started)
	if first == "b" || second == "b" {
		t.Fatal("dependent call ran early")
	}
	cancel()
	out := receive(t, results)
	if len(out) != 3 || out[1] != "Error: cancelled before execution" {
		t.Fatal(out)
	}
	select {
	case id := <-started:
		t.Fatalf("unexpected call %s", id)
	default:
	}
}

func TestParallelToolCyclePreservesResultsAndDependentReads(t *testing.T) {
	rounds := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req llm.Request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
			return
		}
		rounds++
		var delta any
		reason := "tool_calls"
		if rounds == 1 {
			delta = map[string]any{"tool_calls": []any{
				map[string]any{"index": 0, "id": "write", "function": llm.Function{Name: "write", Arguments: `{"path":"a","content":"before"}`}},
				map[string]any{"index": 1, "id": "edit", "function": llm.Function{Name: "edit", Arguments: `{"path":"a","oldText":"before","newText":"after"}`}},
				map[string]any{"index": 2, "id": "read", "function": llm.Function{Name: "read", Arguments: `{"path":"a"}`}},
				map[string]any{"index": 3, "id": "other", "function": llm.Function{Name: "read", Arguments: `{"path":"missing"}`}},
			}}
		} else {
			var results []llm.Message
			for _, m := range req.Messages {
				if m.Role == "tool" {
					results = append(results, m)
				}
			}
			if len(results) != 4 {
				t.Errorf("got %d results", len(results))
			} else {
				for i, id := range []string{"write", "edit", "read", "other"} {
					if results[i].ToolCallID != id {
						t.Error("results reordered")
					}
				}
				if results[2].Content != "1: after\n" || !strings.Contains(results[3].Content, "Error:") {
					t.Error(results)
				}
			}
			delta = map[string]string{"content": "done"}
			reason = "stop"
		}
		b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": delta, "finish_reason": reason}}})
		fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", b)
	}))
	defer server.Close()
	a := Agent{Client: &llm.Client{BaseURL: server.URL}, Tools: tools.Tools{Root: t.TempDir()}}
	if err := a.Run(context.Background(), "edit and verify", nil); err != nil {
		t.Fatal(err)
	}
	if rounds != 2 {
		t.Fatal(rounds)
	}
}
