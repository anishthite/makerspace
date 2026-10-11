package agent

import (
	"context"
	"fmt"

	"github.com/anishthite/spanner-go/internal/llm"
	"github.com/anishthite/spanner-go/internal/tools"
)

type Event struct{ Kind, Text, Name, ID string }
type Agent struct {
	Client   *llm.Client
	Tools    tools.Tools
	MaxTurns int
	Messages []llm.Message
}

// Run is single-owner: callers must wait for it to return before another Run.
func (a *Agent) Run(ctx context.Context, prompt string, emit func(Event)) error {
	send := func(e Event) {
		if emit != nil {
			emit(e)
		}
	}
	if a.MaxTurns < 0 {
		return fmt.Errorf("max-turns cannot be negative")
	}
	if len(a.Messages) == 0 {
		a.Messages = append(a.Messages, llm.Message{Role: "system", Content: "You are a coding assistant in a trusted local workspace. Use the available tools to complete the task. Inspect before editing, verify changes, and report results honestly. Tool errors are recoverable. Do not claim a tool ran unless it did."})
	}
	a.Messages = append(a.Messages, llm.Message{Role: "user", Content: prompt})
	for rounds := 0; ; rounds++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		defs := tools.Definitions()
		capped := a.MaxTurns > 0 && rounds >= a.MaxTurns
		messages := a.Messages
		if capped {
			defs = nil
			messages = append(append([]llm.Message(nil), messages...), llm.Message{Role: "system", Content: "The requested turn limit has been reached. Do not call tools. Give a final answer summarizing progress, verification, and unfinished work."})
		}
		msg, err := a.Client.Stream(ctx, messages, defs, func(text string) { send(Event{Kind: "text", Text: text}) })
		if err != nil {
			return err
		}
		if capped && len(msg.ToolCalls) > 0 {
			return fmt.Errorf("model called tools in final no-tools request")
		}
		a.Messages = append(a.Messages, msg)
		if len(msg.ToolCalls) == 0 {
			return nil
		}
		send(Event{Kind: "separator"})
		results := executeCalls(ctx, a.Tools.Root, msg.ToolCalls, a.Tools.Execute, send)
		for i, tc := range msg.ToolCalls {
			a.Messages = append(a.Messages, llm.Message{Role: "tool", ToolCallID: tc.ID, Content: results[i]})
		}
		if err := ctx.Err(); err != nil {
			return err
		}
	}
}
