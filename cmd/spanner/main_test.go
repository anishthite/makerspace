package main

import (
	"strings"
	"testing"
)

func TestClientFromEnv(t *testing.T) {
	for _, tc := range []struct {
		name string
		env  map[string]string
		want string
		key  string
		err  string
	}{
		{"openrouter", map[string]string{"OPENROUTER_API_KEY": "or-key", "OPENROUTER_MODEL": "openai/gpt-4.1"}, "https://openrouter.ai/api/v1", "or-key", ""},
		{"openrouter wins", map[string]string{"OPENROUTER_API_KEY": "or-key", "OPENROUTER_MODEL": "openai/gpt-4.1", "OPENAI_API_KEY": "openai-key", "OPENAI_MODEL": "different-openai-model", "OPENAI_BASE_URL": "https://example.invalid/v1"}, "https://openrouter.ai/api/v1", "or-key", ""},
		{"openai", map[string]string{"OPENAI_API_KEY": "openai-key", "OPENAI_MODEL": "gpt-4.1"}, "https://api.openai.com/v1", "openai-key", ""},
		{"missing model", map[string]string{"OPENROUTER_API_KEY": "or-key"}, "", "", "OPENROUTER_API_KEY and OPENROUTER_MODEL are required"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client, err := clientFromEnv(func(key string) string { return tc.env[key] })
			if tc.err != "" {
				if err == nil || !strings.Contains(err.Error(), tc.err) {
					t.Fatalf("error = %v, want %q", err, tc.err)
				}
				return
			}
			model := tc.env["OPENAI_MODEL"]
			if tc.env["OPENROUTER_API_KEY"] != "" {
				model = tc.env["OPENROUTER_MODEL"]
			}
			if err != nil || client.BaseURL != tc.want || client.APIKey != tc.key || client.Model != model {
				t.Fatalf("client = %#v, error = %v", client, err)
			}
		})
	}
}
