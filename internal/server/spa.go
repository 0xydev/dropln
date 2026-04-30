package server

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/0xydev/dropln/web"
)

// spaHandler serves the embedded frontend bundle.
//
//   - Real files in dist/ (e.g. /assets/index-abc.js) → served as-is, with
//     long-lived cache headers since Vite hashes filenames.
//   - SPA routes (e.g. /, /p/abc123…) → fall back to index.html.
//   - /api/* → 404 (the API mux already handled known endpoints; reaching
//     here means the path is unknown and we shouldn't serve HTML for it).
func spaHandler() http.Handler {
	root, err := fs.Sub(web.DistFS, "dist")
	if err != nil {
		// fs.Sub on an embed.FS only fails if the path is malformed;
		// build-time guarantee, so this is unreachable in production.
		panic(err)
	}
	indexBytes, err := fs.ReadFile(root, "index.html")
	if err != nil {
		// Same: dist/index.html is always produced by Vite.
		panic(err)
	}

	fileServer := http.FileServer(http.FS(root))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")

		// Don't let the catch-all swallow unknown API requests.
		if strings.HasPrefix(path, "api/") {
			http.NotFound(w, r)
			return
		}

		// Try to serve the literal file from dist/.
		if path != "" && path != "index.html" {
			if f, err := root.Open(path); err == nil {
				_ = f.Close()
				if strings.HasPrefix(path, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				fileServer.ServeHTTP(w, r)
				return
			}
		}

		// SPA fallback: serve index.html for unknown paths.
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(indexBytes)
	})
}
