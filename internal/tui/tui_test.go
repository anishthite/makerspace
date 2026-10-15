package tui

import (
	"context"
	"strings"
	"testing"

	"github.com/anishthite/spanner-go/internal/agent"
	tea "github.com/charmbracelet/bubbletea"
)

func TestConcurrentToolRowsStayCorrelated(t *testing.T) {
	m := New(context.Background(), nil, "")
	m.input.SetValue("next prompt")
	for _, e := range []agent.Event{
		{Kind: "tool_start", Name: "read", ID: "a", Text: "first"},
		{Kind: "tool_start", Name: "read", ID: "b", Text: "second"},
		{Kind: "tool_end", Name: "read", ID: "b", Text: "second result"},
		{Kind: "tool_end", Name: "read", ID: "a", Text: "first result"},
	} {
		m.Update(e)
	}
	for _, row := range []string{"→ read [a] first", "→ read [b] second", "← read [b]: second result", "← read [a]: first result"} {
		if !strings.Contains(m.transcript, row) {
			t.Fatalf("missing %q", row)
		}
	}
	if m.input.Value() != "next prompt" {
		t.Fatal("tool events changed input")
	}
}

func TestTranscriptPreservesComposer(t *testing.T) {
	m := New(context.Background(), nil, "")
	m.input.SetValue("next prompt")
	m.Update(tea.WindowSizeMsg{Width: 50, Height: 20})
	for _, e := range []agent.Event{{Kind: "text", Text: "hello"}, {Kind: "tool_start", Name: "read", Text: `{"path":"a"}`}, {Kind: "tool_end", Name: "read", Text: "1: content"}} {
		m.Update(e)
	}
	if m.input.Value() != "next prompt" {
		t.Fatal("stream corrupted composer")
	}
	if !strings.Contains(m.View(), "hello") || !strings.Contains(m.View(), "read") {
		t.Fatal(m.View())
	}
	m.busy = true
	cancelled := false
	m.cancel = func() { cancelled = true }
	m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	if !cancelled || !m.busy {
		t.Fatal("cancel must wait for work to finish")
	}
	m.Update(doneMsg{context.Canceled})
	if m.busy {
		t.Fatal("remained busy")
	}
	if m.input.Value() != "next prompt" {
		t.Fatal("cancellation erased composer")
	}
}
