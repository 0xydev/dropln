package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// runExamples prints a curated, categorized cheatsheet to stdout. Stdout
// (not stderr) so people can `dropln examples > cheatsheet.txt` if they
// want a copy.
//
// Each section is a real workflow — not a flag dump. The flag dump lives
// in --help; this is the "I just installed it, what do I do?" surface.

type cheatSection struct {
	title string
	intro string // optional one-line setup
	items []cheatItem
}

type cheatItem struct {
	desc string
	cmd  string
}

func runExamples() error {
	sections := []cheatSection{
		{
			title: "Send a secret",
			items: []cheatItem{
				{"pipe stdin → URL", `echo "$API_KEY" | dropln`},
				{"command output", `docker compose logs --tail 50 | dropln`},
				{"with a note for your local history", `cat .env | dropln --note "prod env, 30-min link"`},
			},
		},
		{
			title: "Self-destruct on first read",
			intro: "URL gets a #- prefix; opening it consumes the paste atomically.",
			items: []cheatItem{
				{"one-time-read paste", `echo "ssh password: hunter2" | dropln --burn`},
				{"burn + clipboard copy", `echo "$SECRET" | dropln --burn --copy`},
			},
		},
		{
			title: "Password protection",
			intro: "Combined with the URL fragment via PBKDF2 — server still only sees ciphertext.",
			items: []cheatItem{
				{"add a password", `echo "data" | dropln --password "shared-phrase"`},
				{"send password separately, paste in DM", `echo "data" | dropln --password "$(date +%F)" --copy`},
			},
		},
		{
			title: "Expiry",
			items: []cheatItem{
				{"5 minutes (debugging)", `cat trace.log | dropln --expire 5min`},
				{"1 hour (default-ish)", `cat .env | dropln --expire 1hour`},
				{"1 week", `cat README.md | dropln --expire 1week`},
				{"never (until manually deleted)", `dropln --file backup.tar.gz --expire never`},
			},
		},
		{
			title: "File attachments",
			items: []cheatItem{
				{"single file", `dropln --file screenshot.png`},
				{"file + text caption", `dropln --file diagram.png < explanation.md`},
				{"burn + file (one-time download)", `dropln --file build.zip --burn --expire 1hour`},
			},
		},
		{
			title: "QR code (scan with phone)",
			items: []cheatItem{
				{"print QR alongside the URL", `echo "wifi pwd: hunter2" | dropln --qr`},
			},
		},
		{
			title: "Fetch a paste",
			items: []cheatItem{
				{"by full URL", `dropln "https://dropln.com/p/abc123def456789a#KEY"`},
				{"to file (instead of stdout)", `dropln <URL> --output secrets.env`},
				{"attachment only, into a directory", `dropln <URL> --no-text --extract ~/downloads`},
			},
		},
		{
			title: "History + delete",
			items: []cheatItem{
				{"list pastes you created", `dropln list`},
				{"delete (uses cached delete-token)", `dropln delete 9e6a2dc6ab47c29b`},
				{"delete with explicit token", `dropln delete <id> --token <delete_token>`},
			},
		},
		{
			title: "Scripting",
			items: []cheatItem{
				{"capture URL only (--quiet)", `URL=$(echo "data" | dropln -q)`},
				{"in CI: post test output as a link", `URL=$(make test 2>&1 | dropln -q --expire 1week) && echo "::notice::logs $URL"`},
				{"point at a self-hosted instance", `export DROPLN_SERVER=https://paste.example.com`},
			},
		},
	}

	w := os.Stdout

	fmt.Fprintln(w, styleAccent.Render("dropln")+styleDim.Render(" — common flows"))
	fmt.Fprintln(w)

	cmdStyle := lipgloss.NewStyle().Foreground(colAccent)
	descStyle := lipgloss.NewStyle().Foreground(colFg)
	titleStyle := lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	introStyle := lipgloss.NewStyle().Foreground(colDim).Italic(true).MarginLeft(2)

	for _, s := range sections {
		fmt.Fprintln(w, titleStyle.Render("▸ "+s.title))
		if s.intro != "" {
			fmt.Fprintln(w, introStyle.Render(s.intro))
		}
		for _, it := range s.items {
			fmt.Fprintln(w, "  "+descStyle.Render(it.desc))
			fmt.Fprintln(w, "    "+cmdStyle.Render(strings.TrimSpace(it.cmd)))
		}
		fmt.Fprintln(w)
	}

	fmt.Fprintln(w, styleDim.Render("Full reference: dropln --help"))
	fmt.Fprintln(w, styleDim.Render("Web docs: https://github.com/0xydev/dropln"))

	return nil
}
