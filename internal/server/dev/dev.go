// Package dev exposes development-only static assets.
// Currently: a vanilla-JS round-trip page used to verify JS↔Go interop
// of the Format v2 envelope and AES-GCM/PBKDF2 parameters.
package dev

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed round-trip.html
var assets embed.FS

// Handler serves the embedded dev assets. Mount under "/_dev/" with StripPrefix.
func Handler() http.Handler {
	sub, err := fs.Sub(assets, ".")
	if err != nil {
		panic(err) // embed contents are static; this can only fail at build time
	}
	return http.FileServer(http.FS(sub))
}
