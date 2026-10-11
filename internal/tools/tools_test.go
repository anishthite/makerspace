package tools

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFiles(t *testing.T) {
	root := t.TempDir()
	tools := Tools{Root: root}
	call := func(name string, args any) string {
		b, _ := json.Marshal(args)
		return tools.Execute(context.Background(), name, string(b))
	}
	if s := call("write", map[string]any{"path": "sub/a", "content": "one\ntwo\n"}); strings.Contains(s, "Error:") {
		t.Fatal(s)
	}
	if s := call("read", map[string]any{"path": "sub/a", "offset": 2, "limit": 1}); s != "2: two\n" {
		t.Fatal(s)
	}
	if s := call("edit", map[string]any{"path": "sub/a", "oldText": "two", "newText": "three"}); strings.Contains(s, "Error:") {
		t.Fatal(s)
	}
	b, _ := os.ReadFile(filepath.Join(root, "sub/a"))
	if string(b) != "one\nthree\n" {
		t.Fatal(string(b))
	}
	call("write", map[string]any{"path": "repeat", "content": "aaa"})
	for _, old := range []string{"aa", "missing"} {
		if s := call("edit", map[string]any{"path": "repeat", "oldText": old, "newText": "x"}); !strings.Contains(s, "Error:") {
			t.Fatal(s)
		}
	}
	if s := call("read", map[string]any{"path": "sub/a", "offset": 0}); !strings.Contains(s, "Error:") {
		t.Fatal(s)
	}
	if s := call("write", map[string]any{"path": "sub/a"}); !strings.Contains(s, "Error:") {
		t.Fatal(s)
	}
	if err := os.WriteFile(filepath.Join(root, "binary"), []byte{255}, 0600); err != nil {
		t.Fatal(err)
	}
	if s := call("read", map[string]any{"path": "binary"}); !strings.Contains(s, "UTF-8") {
		t.Fatal(s)
	}
}

func TestBashBoundsAndCancellation(t *testing.T) {
	tools := Tools{Root: t.TempDir()}
	out := tools.Execute(context.Background(), "bash", `{"command":"printf 'hello'; printf 'err' >&2; exit 2"}`)
	if !strings.Contains(out, "helloerr") || !strings.Contains(out, "Error:") {
		t.Fatal(out)
	}
	out = tools.Execute(context.Background(), "bash", `{"command":"yes x | head -c 100000; exit 2"}`)
	if !strings.Contains(out, "Error:") || !strings.Contains(out, "[output truncated]") || len(out) > OutputLimit+30 {
		t.Fatalf("output length %d", len(out))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	out = tools.Execute(ctx, "bash", `{"command":"sleep 30 & wait"}`)
	if time.Since(start) > 2*time.Second || !strings.Contains(out, "deadline exceeded") {
		t.Fatal(out)
	}
	out = tools.Execute(context.Background(), "bash", `{"command":"sleep 30","timeout":1}`)
	if !strings.Contains(out, "deadline exceeded") {
		t.Fatal(out)
	}
}
