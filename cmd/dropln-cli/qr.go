package main

import (
	"bytes"
	"fmt"
	"os"

	"github.com/mdp/qrterminal/v3"
)

// printQR writes a Unicode-block QR for the given URL to stderr (so the
// stdout URL stays pipe-clean). Error correction "L" is fine — the URL
// fits in ~50 chars and we own the rendering surface (no smudges).
//
// Half-block characters (▀ ▄) make the code roughly square at standard
// terminal aspect ratios. Quiet zone is 1 module — enough for most camera
// apps without eating half the screen.
func printQR(url string) {
	cfg := qrterminal.Config{
		Level:      qrterminal.L,
		Writer:     os.Stderr,
		HalfBlocks: true,
		QuietZone:  1,
		BlackChar:  qrterminal.BLACK_BLACK,
		WhiteChar:  qrterminal.WHITE_WHITE,
		BlackWhiteChar: qrterminal.BLACK_WHITE,
		WhiteBlackChar: qrterminal.WHITE_BLACK,
	}

	// Render to a buffer first so we can box it with a heading.
	var buf bytes.Buffer
	cfg.Writer = &buf
	qrterminal.GenerateWithConfig(url, cfg)

	fmt.Fprintln(os.Stderr)
	fmt.Fprintln(os.Stderr, styleDim.Render("  scan to open on phone"))
	fmt.Fprint(os.Stderr, buf.String())
}
