package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// historyEntry tracks a paste this user created so the CLI can offer
// `ulakbin list` and `ulakbin delete <id>` without re-typing the
// delete-token. File is XDG-compliant; perms are 0600 (contains
// secrets — delete tokens). Never logged or exfiltrated.
type historyEntry struct {
	ID          string     `json:"id"`
	Key         string     `json:"key"` // base64-url, for completeness — not used yet
	DeleteToken string     `json:"delete_token"`
	URL         string     `json:"url"`
	Server      string     `json:"server"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	Burn        bool       `json:"burn"`
	Note        string     `json:"note,omitempty"`
}

type history struct {
	Pastes []historyEntry `json:"pastes"`
}

func historyPath() (string, error) {
	if p := os.Getenv("ULAKBIN_HISTORY"); p != "" {
		return p, nil
	}
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "ulakbin", "history.json"), nil
}

func loadHistory() (*history, error) {
	p, err := historyPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(p)
	if errors.Is(err, fs.ErrNotExist) {
		return &history{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read history: %w", err)
	}
	var h history
	if err := json.Unmarshal(data, &h); err != nil {
		return nil, fmt.Errorf("parse history: %w", err)
	}
	return &h, nil
}

func saveHistory(h *history) error {
	p, err := historyPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return fmt.Errorf("mkdir history: %w", err)
	}
	data, err := json.MarshalIndent(h, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o600)
}

func (h *history) add(e historyEntry) {
	h.Pastes = append(h.Pastes, e)
}

func (h *history) find(id string) *historyEntry {
	for i := range h.Pastes {
		if h.Pastes[i].ID == id {
			return &h.Pastes[i]
		}
	}
	return nil
}

func (h *history) remove(id string) bool {
	for i, e := range h.Pastes {
		if e.ID == id {
			h.Pastes = append(h.Pastes[:i], h.Pastes[i+1:]...)
			return true
		}
	}
	return false
}

// prune drops entries whose expires_at is in the past. Returns count removed.
func (h *history) prune() int {
	now := time.Now()
	kept := make([]historyEntry, 0, len(h.Pastes))
	pruned := 0
	for _, e := range h.Pastes {
		if e.ExpiresAt != nil && now.After(*e.ExpiresAt) {
			pruned++
			continue
		}
		kept = append(kept, e)
	}
	h.Pastes = kept
	return pruned
}

// recordPaste loads, prunes, appends, saves. Best-effort: failures are
// surfaced but don't block the paste creation that already succeeded.
func recordPaste(e historyEntry) error {
	h, err := loadHistory()
	if err != nil {
		return err
	}
	h.prune()
	h.add(e)
	return saveHistory(h)
}

// ─── list ────────────────────────────────────────────────────────────────

func runList() error {
	h, err := loadHistory()
	if err != nil {
		return err
	}
	pruned := h.prune()
	if pruned > 0 {
		_ = saveHistory(h)
	}
	if len(h.Pastes) == 0 {
		fmt.Fprintln(os.Stderr, "no pastes in local history")
		if pruned > 0 {
			fmt.Fprintf(os.Stderr, "(pruned %d expired entries)\n", pruned)
		}
		return nil
	}
	// Newest first.
	sort.SliceStable(h.Pastes, func(i, j int) bool {
		return h.Pastes[i].CreatedAt.After(h.Pastes[j].CreatedAt)
	})

	fmt.Printf("%-16s  %-13s  %-12s  %-4s  %s\n", "ID", "CREATED", "EXPIRES", "BURN", "SERVER")
	for _, e := range h.Pastes {
		expires := "never"
		if e.ExpiresAt != nil {
			d := time.Until(*e.ExpiresAt)
			if d < 0 {
				expires = "expired"
			} else {
				expires = humanizeDuration(d)
			}
		}
		burn := "no"
		if e.Burn {
			burn = "YES"
		}
		fmt.Printf("%-16s  %-13s  %-12s  %-4s  %s\n",
			e.ID,
			humanizeAgo(time.Since(e.CreatedAt)),
			expires,
			burn,
			e.Server,
		)
	}
	return nil
}

func humanizeAgo(d time.Duration) string {
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd ago", int(d.Hours())/24)
	}
}

func humanizeDuration(d time.Duration) string {
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	case d < 30*24*time.Hour:
		return fmt.Sprintf("%dd", int(d.Hours())/24)
	default:
		return fmt.Sprintf("%dmo", int(d.Hours())/(24*30))
	}
}
