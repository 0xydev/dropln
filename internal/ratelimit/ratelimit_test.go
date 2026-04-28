package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestLimiter_AllowsBurstThenBlocks(t *testing.T) {
	// 60/min = 1/sec; burst = 3 means we can do 3 instantly, then refill at 1/s.
	l := New(60, 3, time.Hour)
	for i := range 3 {
		if !l.Allow("a") {
			t.Fatalf("burst %d should be allowed", i)
		}
	}
	if l.Allow("a") {
		t.Error("4th call should be blocked (burst exhausted)")
	}
}

func TestLimiter_PerKeyIsolation(t *testing.T) {
	l := New(60, 1, time.Hour)
	if !l.Allow("a") {
		t.Error("key a: first call should pass")
	}
	if l.Allow("a") {
		t.Error("key a: second call should be blocked")
	}
	if !l.Allow("b") {
		t.Error("key b should be unaffected by key a")
	}
}

func TestLimiter_Sweep(t *testing.T) {
	l := New(60, 1, 10*time.Millisecond)
	l.Allow("a")
	if l.Size() != 1 {
		t.Fatalf("Size after Allow: got %d, want 1", l.Size())
	}
	time.Sleep(20 * time.Millisecond)
	l.sweep()
	if l.Size() != 0 {
		t.Errorf("Size after sweep: got %d, want 0", l.Size())
	}
}

func TestMiddleware_Returns429(t *testing.T) {
	l := New(60, 1, time.Hour)
	mw := Middleware(l, func(*http.Request) string { return "any" })
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	rec1 := httptest.NewRecorder()
	h.ServeHTTP(rec1, httptest.NewRequest("POST", "/", nil))
	if rec1.Code != http.StatusOK {
		t.Errorf("first request: got %d, want 200", rec1.Code)
	}

	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, httptest.NewRequest("POST", "/", nil))
	if rec2.Code != http.StatusTooManyRequests {
		t.Errorf("second request: got %d, want 429", rec2.Code)
	}
	if got := rec2.Header().Get("Retry-After"); got != "60" {
		t.Errorf("Retry-After: got %q, want %q", got, "60")
	}
}

func TestClientIP(t *testing.T) {
	cases := []struct {
		name        string
		remoteAddr  string
		xff         string
		xRealIP     string
		trustProxy  bool
		want        string
	}{
		{name: "remote addr ipv4", remoteAddr: "192.0.2.1:1234", want: "192.0.2.1"},
		{name: "remote addr ipv6", remoteAddr: "[2001:db8::1]:1234", want: "2001:db8::1"},
		{name: "xff trusted", remoteAddr: "10.0.0.1:1234", xff: "203.0.113.5, 10.0.0.1", trustProxy: true, want: "203.0.113.5"},
		{name: "xff ignored when untrusted", remoteAddr: "10.0.0.1:1234", xff: "203.0.113.5", trustProxy: false, want: "10.0.0.1"},
		{name: "xrealip fallback", remoteAddr: "10.0.0.1:1234", xRealIP: "203.0.113.9", trustProxy: true, want: "203.0.113.9"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/", nil)
			r.RemoteAddr = tc.remoteAddr
			if tc.xff != "" {
				r.Header.Set("X-Forwarded-For", tc.xff)
			}
			if tc.xRealIP != "" {
				r.Header.Set("X-Real-IP", tc.xRealIP)
			}
			got := ClientIP(r, tc.trustProxy)
			if got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}
