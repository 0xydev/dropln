package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Addr           string
	DatabaseURL    string
	MaxPasteBytes  int64
	PurgeInterval  time.Duration
	PurgeBatchSize int

	// Rate limiting (applied to POST /api/v1/paste).
	RateLimitPerMin int
	RateLimitBurst  int
	RateLimitTTL    time.Duration

	// When true, ClientIP honors X-Forwarded-For / X-Real-IP. Only enable
	// behind a trusted reverse proxy that strips spoofed values.
	TrustProxy bool

	// When true, send Strict-Transport-Security. Only enable when serving
	// over HTTPS (typically behind a TLS-terminating proxy).
	HSTS bool
}

func Load() (*Config, error) {
	cfg := &Config{
		Addr:            getEnv("ULAKBIN_ADDR", ":8080"),
		DatabaseURL:     os.Getenv("ULAKBIN_DATABASE_URL"),
		MaxPasteBytes:   10 * 1024 * 1024,
		PurgeInterval:   5 * time.Minute,
		PurgeBatchSize:  1000,
		RateLimitPerMin: 10,
		RateLimitBurst:  5,
		RateLimitTTL:    time.Hour,
	}

	if v := os.Getenv("ULAKBIN_MAX_PASTE_BYTES"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("ULAKBIN_MAX_PASTE_BYTES: %w", err)
		}
		cfg.MaxPasteBytes = n
	}

	if v := os.Getenv("ULAKBIN_RATE_LIMIT_PER_MIN"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("ULAKBIN_RATE_LIMIT_PER_MIN: %w", err)
		}
		cfg.RateLimitPerMin = n
	}

	if v := os.Getenv("ULAKBIN_RATE_LIMIT_BURST"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("ULAKBIN_RATE_LIMIT_BURST: %w", err)
		}
		cfg.RateLimitBurst = n
	}

	cfg.TrustProxy = parseBool(os.Getenv("ULAKBIN_TRUST_PROXY"))
	cfg.HSTS = parseBool(os.Getenv("ULAKBIN_HSTS"))

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("ULAKBIN_DATABASE_URL is required")
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func parseBool(s string) bool {
	switch s {
	case "1", "true", "TRUE", "True", "yes", "on":
		return true
	}
	return false
}
