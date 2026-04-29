// Package web exposes the built frontend assets to the Go binary.
//
// The contents of dist/ are produced by `npm run build` (Vite). The Makefile
// runs the frontend build before the Go build, so dist/ is always present
// at compile time.
package web

import "embed"

//go:embed all:dist
var DistFS embed.FS
