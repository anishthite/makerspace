package llm

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRequestCancellation(t *testing.T) {
	stopped := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(stopped)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, err := (&Client{BaseURL: server.URL}).Stream(ctx, nil, nil, nil)
	if err == nil {
		t.Fatal("expected cancellation")
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("HTTP request remained active")
	}
}
func TestStreamErrors(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"http", "bad request", 400}, {"partial", "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n", 200}, {"invalid", "data: nope\n\n", 200}, {"length", "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\n\n", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer test" || !strings.HasSuffix(r.URL.Path, "/chat/completions") {
					t.Error("invalid request")
				}
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			}))
			defer server.Close()
			_, err := (&Client{BaseURL: server.URL, APIKey: "test"}).Stream(context.Background(), nil, nil, nil)
			if err == nil {
				t.Fatal("expected error")
			}
		})
	}
}
