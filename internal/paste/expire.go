package paste

import (
	"fmt"
	"time"
)

// expireOptions lists allowed `meta.expire` values in the order the UI should
// present them. expireDurations is the lookup form.
var expireOptions = []string{"5min", "10min", "1hour", "1day", "1week", "1month", "1year", "never"}

// expireDurations maps PrivateBin's allowed `meta.expire` values to durations.
// "never" maps to zero (sentinel) and produces a nil expiration time.
var expireDurations = map[string]time.Duration{
	"5min":   5 * time.Minute,
	"10min":  10 * time.Minute,
	"1hour":  time.Hour,
	"1day":   24 * time.Hour,
	"1week":  7 * 24 * time.Hour,
	"1month": 30 * 24 * time.Hour,
	"1year":  365 * 24 * time.Hour,
	"never":  0,
}

// ExpireOptions returns the allowed `meta.expire` values in display order.
func ExpireOptions() []string {
	out := make([]string, len(expireOptions))
	copy(out, expireOptions)
	return out
}

// FormatterOptions returns the formatter strings that the UI may offer.
// PrivateBin treats this field as opaque server-side, but we expose the
// well-known set so the frontend doesn't hardcode them.
func FormatterOptions() []string {
	return []string{
		string(FormatterPlaintext),
		string(FormatterSyntaxHighlighting),
		string(FormatterMarkdown),
	}
}

// ResolveExpire returns the absolute expiration time for the given expire
// value, or nil for "never". now is taken as a parameter so callers can
// pin the clock in tests.
func ResolveExpire(value string, now time.Time) (*time.Time, error) {
	d, ok := expireDurations[value]
	if !ok {
		return nil, fmt.Errorf("expire: unsupported value %q", value)
	}
	if d == 0 {
		return nil, nil
	}
	t := now.Add(d)
	return &t, nil
}
