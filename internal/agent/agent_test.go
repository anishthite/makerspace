package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/anishthite/spanner-go/internal/llm"
	"github.com/anishthite/spanner-go/internal/tools"
)

func TestUncappedBeyondTenRounds(t *testing.T) {
	rounds := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rounds++
		if rounds <= 12 {
			fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call%d\",\"function\":{\"name\":\"read\",\"arguments\":\"{\\\"path\\\":\\\"missing\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n", rounds)
		} else {
			fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"finished\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
		}
	}))
	defer server.Close()
	a := Agent{Client: &llm.Client{BaseURL: server.URL}, Tools: tools.Tools{Root: t.TempDir()}}
	if err := a.Run(context.Background(), "keep going", nil); err != nil {
		t.Fatal(err)
	}
	if rounds != 13 {
		t.Fatalf("default stopped at %d rounds", rounds)
	}
}

func TestToolCycleAndCap(t *testing.T) {
	for _, cap := range []int{0, 1} {
		t.Run(fmt.Sprint(cap), func(t *testing.T) {
			rounds := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var req llm.Request
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					t.Error(err)
					return
				}
				rounds++
				w.Header().Set("Content-Type", "text/event-stream")
				if rounds == 1 {
					fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call1\",\"function\":{\"name\":\"read\",\"arguments\":\"{\\\"path\\\":\"}}]},\"finish_reason\":null}]}\n\n")
					fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"missing\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n")
				} else {
					found := false
					for _, m := range req.Messages {
						if m.Role == "tool" && m.ToolCallID == "call1" && strings.Contains(m.Content, "Error:") {
							found = true
						}
					}
					if !found {
						t.Error("missing recoverable tool result")
					}
					if cap == 1 && len(req.Tools) != 0 {
						t.Error("cap must remove tools")
					}
					if cap == 0 && len(req.Tools) != 4 {
						t.Error("uncapped request must offer tools")
					}
					fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"done\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
				}
			}))
			defer server.Close()
			a := Agent{Client: &llm.Client{BaseURL: server.URL, Model: "fake"}, Tools: tools.Tools{Root: t.TempDir()}, MaxTurns: cap}
			var text string
			if err := a.Run(context.Background(), "read file", func(e Event) {
				if e.Kind == "text" {
					text += e.Text
				}
			}); err != nil {
				t.Fatal(err)
			}
			if rounds != 2 || text != "done" {
				t.Fatalf("rounds=%d text=%q", rounds, text)
			}
		})
	}
}
