package server

import (
	"net/http"
	"strings"
)

// securityHeaders applies a defensive baseline to every response.
//
// Style-src keeps 'unsafe-inline' because React renders inline styles
// (style={{...}}) and CodeMirror injects style tags at runtime — moving to
// nonce/hash-based CSP would require a build-time pipeline that's not worth
// the complexity for a tool whose security model is primarily client-side
// crypto. Script-src is fully strict — bundled output has no inline scripts.
//
// The /_dev/ endpoint ships inline scripts/styles, so when DevEndpoints is
// true we relax script-src for that path only — the strict policy still
// applies to every production response.
func securityHeaders(hsts, devEndpoints bool) func(http.Handler) http.Handler {
	const baseCSP = "default-src 'none'; " +
		"script-src 'self'; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data:; " +
		"font-src 'self'; " +
		"connect-src 'self'; " +
		"manifest-src 'self'; " +
		"worker-src 'self'; " +
		"frame-ancestors 'none'; " +
		"form-action 'self'; " +
		"base-uri 'self'"

	const devCSP = "default-src 'none'; " +
		"script-src 'self' 'unsafe-inline'; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data:; " +
		"font-src 'self'; " +
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
			h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()")
			h.Set("Cross-Origin-Opener-Policy", "same-origin")
			h.Set("Cross-Origin-Resource-Policy", "same-origin")

			if devEndpoints && strings.HasPrefix(r.URL.Path, "/_dev/") {
				h.Set("Content-Security-Policy", devCSP)
			} else {
				h.Set("Content-Security-Policy", baseCSP)
			}

			if hsts {
				h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
			}
			next.ServeHTTP(w, r)
		})
	}
}
