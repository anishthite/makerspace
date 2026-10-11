package main

import (
	"context"
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/anishthite/spanner-go/internal/agent"
	"github.com/anishthite/spanner-go/internal/llm"
	"github.com/anishthite/spanner-go/internal/tools"
	"github.com/anishthite/spanner-go/internal/tui"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "spanner:", err)
		os.Exit(1)
	}
}
func run() error {
	maxTurns := flag.Int("max-turns", 0, "optional model/tool round cap; 0 is uncapped, followed by a final no-tools answer when capped")
	headless := flag.Bool("headless", false, "stream to stdout without the interactive UI")
	flag.Parse()
	if *maxTurns < 0 {
		return fmt.Errorf("max-turns must be nonnegative")
	}
	key, model := os.Getenv("OPENAI_API_KEY"), os.Getenv("OPENAI_MODEL")
	if key == "" || model == "" {
		return fmt.Errorf("OPENAI_API_KEY and OPENAI_MODEL are required")
	}
	base := os.Getenv("OPENAI_BASE_URL")
	if base == "" {
		base = "https://api.openai.com/v1"
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return fmt.Errorf("OPENAI_BASE_URL must be an HTTP(S) base URL, e.g. https://api.openai.com/v1")
	}
	root, err := os.Getwd()
	if err != nil {
		return err
	}
	a := &agent.Agent{Client: &llm.Client{BaseURL: base, APIKey: key, Model: model}, Tools: tools.Tools{Root: root}, MaxTurns: *maxTurns}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	prompt := strings.Join(flag.Args(), " ")
	if !*headless {
		return tui.Run(ctx, a, prompt)
	}
	if strings.TrimSpace(prompt) == "" {
		return fmt.Errorf("headless mode requires a prompt")
	}
	err = a.Run(ctx, prompt, func(e agent.Event) {
		switch e.Kind {
		case "text":
			fmt.Print(e.Text)
		case "separator":
			fmt.Println()
		case "tool_start":
			fmt.Fprintf(os.Stderr, "→ %s\n", e.Name)
		case "tool_end":
			fmt.Fprintf(os.Stderr, "← %s: %s\n", e.Name, e.Text)
		}
	})
	fmt.Println()
	return err
}
