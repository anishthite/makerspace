package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type Function struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}
type ToolCall struct {
	ID       string   `json:"id"`
	Type     string   `json:"type"`
	Function Function `json:"function"`
}
type Message struct {
	Role       string     `json:"role"`
	Content    string     `json:"content"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}
type Definition struct {
	Type     string             `json:"type"`
	Function FunctionDefinition `json:"function"`
}
type FunctionDefinition struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Parameters  any    `json:"parameters"`
}
type Request struct {
	Model    string       `json:"model"`
	Messages []Message    `json:"messages"`
	Tools    []Definition `json:"tools,omitempty"`
	Stream   bool         `json:"stream"`
}
type Client struct {
	BaseURL, APIKey, Model string
	HTTP                   *http.Client
}

func (c *Client) Stream(ctx context.Context, messages []Message, tools []Definition, onText func(string)) (Message, error) {
	msg := Message{Role: "assistant"}
	body, err := json.Marshal(Request{c.Model, messages, tools, true})
	if err != nil {
		return msg, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(c.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return msg, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	client := c.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return msg, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
		return msg, fmt.Errorf("API HTTP %d: %s", resp.StatusCode, b)
	}
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 4096), 4<<20)
	var data []string
	finished := false
	consume := func() error {
		if len(data) == 0 {
			return nil
		}
		payload := strings.Join(data, "\n")
		data = nil
		if payload == "[DONE]" {
			finished = true
			return nil
		}
		var chunk struct {
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
			Choices []struct {
				Delta struct {
					Content   string `json:"content"`
					ToolCalls []struct {
						Index    int      `json:"index"`
						ID       string   `json:"id"`
						Type     string   `json:"type"`
						Function Function `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			return fmt.Errorf("invalid stream event: %w", err)
		}
		if chunk.Error != nil {
			return fmt.Errorf("API: %s", chunk.Error.Message)
		}
		if len(chunk.Choices) == 0 {
			return nil
		}
		choice := chunk.Choices[0]
		if choice.Delta.Content != "" {
			msg.Content += choice.Delta.Content
			if onText != nil {
				onText(choice.Delta.Content)
			}
		}
		for _, d := range choice.Delta.ToolCalls {
			if d.Index < 0 || d.Index > 127 {
				return fmt.Errorf("invalid tool index %d", d.Index)
			}
			for len(msg.ToolCalls) <= d.Index {
				msg.ToolCalls = append(msg.ToolCalls, ToolCall{Type: "function"})
			}
			t := &msg.ToolCalls[d.Index]
			t.ID += d.ID
			if d.Type != "" {
				t.Type = d.Type
			}
			t.Function.Name += d.Function.Name
			t.Function.Arguments += d.Function.Arguments
		}
		if choice.FinishReason != nil {
			if *choice.FinishReason != "stop" && *choice.FinishReason != "tool_calls" {
				return fmt.Errorf("model stopped with %s", *choice.FinishReason)
			}
			finished = true
		}
		return nil
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if err := consume(); err != nil {
				return msg, err
			}
			continue
		}
		if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if err := scanner.Err(); err != nil {
		return msg, err
	}
	if err := consume(); err != nil {
		return msg, err
	}
	if !finished {
		return msg, fmt.Errorf("stream ended before completion")
	}
	for _, t := range msg.ToolCalls {
		if t.ID == "" || t.Function.Name == "" || !json.Valid([]byte(t.Function.Arguments)) {
			return msg, fmt.Errorf("incomplete tool call")
		}
	}
	return msg, nil
}
