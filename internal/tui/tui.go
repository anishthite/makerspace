package tui

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/anishthite/spanner-go/internal/agent"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type doneMsg struct{ err error }
type Model struct {
	agent         *agent.Agent
	root          context.Context
	cancel        context.CancelFunc
	workers       *sync.WaitGroup
	events        chan tea.Msg
	input         textarea.Model
	view          viewport.Model
	transcript    string
	initial       string
	busy, exiting bool
	width         int
}

func New(ctx context.Context, a *agent.Agent, prompt string) *Model {
	input := textarea.New()
	input.Placeholder = "Ask about this repository…"
	input.ShowLineNumbers = false
	input.SetHeight(3)
	input.SetWidth(80)
	input.CharLimit = 0
	input.Focus()
	return &Model{agent: a, root: ctx, workers: &sync.WaitGroup{}, events: make(chan tea.Msg, 64), input: input, view: viewport.New(80, 16), initial: prompt, width: 80}
}

// Run waits for cancelled work to finish before returning to the process.
func Run(ctx context.Context, a *agent.Agent, prompt string) error {
	root, cancel := context.WithCancel(ctx)
	defer cancel()
	model := New(root, a, prompt)
	_, err := tea.NewProgram(model, tea.WithAltScreen(), tea.WithContext(root)).Run()
	cancel()
	if model.cancel != nil {
		model.cancel()
	}
	model.workers.Wait()
	return err
}

func (m *Model) wait() tea.Cmd {
	return func() tea.Msg {
		select {
		case e := <-m.events:
			return e
		case <-m.root.Done():
			return doneMsg{m.root.Err()}
		}
	}
}
func (m *Model) begin(prompt string) tea.Cmd {
	if m.busy || strings.TrimSpace(prompt) == "" {
		return nil
	}
	m.busy = true
	m.input.Reset()
	m.append("\nYou: " + prompt + "\n\nAssistant: ")
	ctx, cancel := context.WithCancel(m.root)
	m.cancel = cancel
	m.workers.Add(1)
	go func() {
		defer m.workers.Done()
		defer cancel()
		err := m.agent.Run(ctx, prompt, func(e agent.Event) {
			select {
			case m.events <- e:
			case <-m.root.Done():
			}
		})
		select {
		case m.events <- doneMsg{err}:
		case <-m.root.Done():
		}
	}()
	return m.wait()
}
func (m *Model) Init() tea.Cmd   { return tea.Batch(textarea.Blink, m.begin(m.initial)) }
func (m *Model) append(s string) { m.transcript += s; m.refresh(true) }
func (m *Model) refresh(bottom bool) {
	m.view.SetContent(lipgloss.NewStyle().Width(m.width).Render(m.transcript))
	if bottom {
		m.view.GotoBottom()
	}
}
func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch e := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = max(1, e.Width)
		m.input.SetWidth(m.width)
		m.view.Width = m.width
		m.view.Height = max(1, e.Height-lipgloss.Height(m.input.View())-2)
		m.refresh(true)
	case agent.Event:
		switch e.Kind {
		case "text":
			m.append(e.Text)
		case "separator":
			m.append("\n")
		case "tool_start":
			m.append("\n  → " + e.Name + " " + compact(e.Text, 160) + "\n")
		case "tool_end":
			m.append("  ← " + e.Name + ": " + compact(e.Text, 240) + "\n")
		}
		return m, m.wait()
	case doneMsg:
		m.busy = false
		m.cancel = nil
		if e.err != nil {
			m.append("\nError: " + e.err.Error())
		}
		m.append("\n")
		if m.exiting {
			return m, tea.Quit
		}
		return m, nil
	case tea.KeyMsg:
		switch e.String() {
		case "ctrl+d":
			if m.busy {
				m.exiting = true
				m.cancel()
				return m, nil
			}
			return m, tea.Quit
		case "ctrl+c":
			if m.busy {
				m.cancel()
			} else {
				m.input.Reset()
			}
			return m, nil
		case "enter":
			if !m.busy {
				return m, m.begin(m.input.Value())
			}
			return m, nil
		case "pgup", "pgdown":
			var cmd tea.Cmd
			m.view, cmd = m.view.Update(msg)
			return m, cmd
		}
	}
	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	return m, cmd
}
func compact(s string, limit int) string {
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) > limit {
		return string(r[:limit]) + "…"
	}
	return s
}
func (m *Model) View() string {
	status := "Enter send · Alt-Enter newline · PgUp/PgDn scroll · Ctrl-D exit"
	if m.busy {
		status = "Working · Ctrl-C cancel · Ctrl-D cancel and exit"
	}
	return fmt.Sprintf("%s\n%s\n%s", m.view.View(), m.input.View(), lipgloss.NewStyle().Faint(true).Render(status))
}
