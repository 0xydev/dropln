package server

import "net/http"

// securityHeaders applies a defensive baseline to every response.
// CSP currently permits 'unsafe-inline' for script and style — the embedded
// dev page (/_dev/round-trip.html) ships inline blocks. Tighten this when the
// production frontend lands as a bundled artifact (M2-final).
func securityHeaders(hsts bool) func(http.Handler) http.Handler {
	const csp = "default-src 'none'; " +
		"script-src 'self' 'unsafe-inline'; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data:; " +
		"connect-src 'self'; " +
		"frame-ancestors 'none'; " +
		"form-action 'self'; " +
		"base-uri 'self'"

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("Content-Security-Policy", csp)
			if hsts {
				h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
			}
			next.ServeHTTP(w, r)
		})
	}
}
