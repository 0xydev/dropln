// Package ratelimit provides a per-key in-memory token bucket suitable for
// HTTP middleware. Idle keys are evicted by a sweeper goroutine.
package ratelimit

import (
	"context"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type Limiter struct {
	rate  rate.Limit
	burst int
	ttl   time.Duration

	mu      sync.Mutex
	buckets map[string]*bucket
}

type bucket struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// New constructs a Limiter that allows eventsPerMinute events per key with the
// given burst. Keys idle longer than ttl are evicted by Run.
func New(eventsPerMinute, burst int, ttl time.Duration) *Limiter {
	if eventsPerMinute <= 0 || burst <= 0 || ttl <= 0 {
		panic("ratelimit.New: eventsPerMinute, burst, ttl must all be > 0")
	}
	return &Limiter{
		rate:    rate.Limit(float64(eventsPerMinute) / 60.0),
		burst:   burst,
		ttl:     ttl,
		buckets: make(map[string]*bucket),
	}
}

// Allow consumes one token for key.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{limiter: rate.NewLimiter(l.rate, l.burst)}
		l.buckets[key] = b
	}
	b.lastSeen = time.Now()
	return b.limiter.Allow()
}

// Run blocks until ctx is cancelled, sweeping idle entries every ttl/2.
func (l *Limiter) Run(ctx context.Context) {
	t := time.NewTicker(l.ttl / 2)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			l.sweep()
		}
	}
}

// Size returns the current number of tracked keys (mostly for tests/metrics).
func (l *Limiter) Size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}

func (l *Limiter) sweep() {
	cutoff := time.Now().Add(-l.ttl)
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, b := range l.buckets {
		if b.lastSeen.Before(cutoff) {
			delete(l.buckets, k)
		}
	}
}

// Middleware returns an http middleware that gates downstream handlers on
// l.Allow(keyFn(r)). On rejection it responds 429 with Retry-After: 60.
func Middleware(l *Limiter, keyFn func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !l.Allow(keyFn(r)) {
				w.Header().Set("Retry-After", "60")
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.WriteHeader(http.StatusTooManyRequests)
				_, _ = w.Write([]byte(`{"error":"rate_limited"}`))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ClientIP extracts the request's client IP. When trustProxy is true, it
// respects X-Forwarded-For (leftmost entry) and X-Real-IP. Otherwise it falls
// back to RemoteAddr (with port stripped).
func ClientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if v := r.Header.Get("X-Forwarded-For"); v != "" {
			if i := strings.IndexByte(v, ','); i >= 0 {
				v = v[:i]
			}
			return strings.TrimSpace(v)
		}
		if v := r.Header.Get("X-Real-IP"); v != "" {
			return strings.TrimSpace(v)
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
