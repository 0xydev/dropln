package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// All decorative output goes through these styles. Lipgloss auto-disables
// colors when the destination isn't a TTY (NO_COLOR env, redirected stderr,
// CI runners) so piping `dropln 2>&1 | grep` still works cleanly.
//
// The palette tracks the web app's CSS variables — same teal accent, same
// status colors — so people who use both feel like one product.

var (
	colAccent = lipgloss.AdaptiveColor{Light: "#0d8b80", Dark: "#14b8a6"}
	colFg     = lipgloss.AdaptiveColor{Light: "#1a1f2a", Dark: "#f5f5f7"}
	colDim    = lipgloss.AdaptiveColor{Light: "#6b7480", Dark: "#76767c"}
	colMuted  = lipgloss.AdaptiveColor{Light: "#9aa3b0", Dark: "#4a4a50"}
	colOK     = lipgloss.AdaptiveColor{Light: "#15803d", Dark: "#2bb673"}
	colErr    = lipgloss.AdaptiveColor{Light: "#c1361b", Dark: "#e0533d"}
	colWarn   = lipgloss.AdaptiveColor{Light: "#b45309", Dark: "#d69e2e"}

	styleOK     = lipgloss.NewStyle().Foreground(colOK).Bold(true)
	styleErr    = lipgloss.NewStyle().Foreground(colErr).Bold(true)
	styleWarn   = lipgloss.NewStyle().Foreground(colWarn)
	styleAccent = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	styleDim    = lipgloss.NewStyle().Foreground(colDim)
	styleMuted  = lipgloss.NewStyle().Foreground(colMuted)
	styleURL    = lipgloss.NewStyle().Foreground(colAccent).Bold(true).Underline(true)
	styleLabel  = lipgloss.NewStyle().Foreground(colDim).Width(15)
)

// printSuccess is the "create succeeded" banner — boxed URL + metadata.
// Stays on stderr so the URL stdout line can still be piped/captured.
func printSuccess(url, deleteToken, expiresIn string, burn, hasPassword bool) {
	fmt.Fprintln(os.Stderr, styleOK.Render("✓")+" "+styleDim.Render("encrypted and uploaded"))

	rows := []string{
		styleLabel.Render("link") + styleURL.Render(url),
		styleLabel.Render("delete token") + styleMuted.Render(deleteToken),
	}
	if expiresIn != "" {
		rows = append(rows, styleLabel.Render("expires in")+styleDim.Render(expiresIn))
	}
	if burn {
		rows = append(rows, styleLabel.Render("")+styleWarn.Render("⚠ self-destructs on first read"))
	}
	if hasPassword {
		rows = append(rows, styleLabel.Render("")+styleWarn.Render("⚠ recipient also needs the password"))
	}

	box := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(colDim).
		Padding(0, 1).
		Render(strings.Join(rows, "\n"))
	fmt.Fprintln(os.Stderr, box)
}

// printWarn / printOK / printErrLn are the single-line status lines used
// outside the create banner. Prefixed with a colored glyph so they stand
// out in a wall of stderr noise.
func printWarn(msg string)  { fmt.Fprintln(os.Stderr, styleWarn.Render("⚠")+" "+msg) }
func printOK(msg string)    { fmt.Fprintln(os.Stderr, styleOK.Render("✓")+" "+msg) }
func printErrLn(msg string) { fmt.Fprintln(os.Stderr, styleErr.Render("✗")+" "+msg) }
