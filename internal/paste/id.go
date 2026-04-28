package paste

import (
	"crypto/rand"
	"encoding/hex"
)

const (
	idBytes          = 8  // 16 hex chars; matches PrivateBin convention
	deleteTokenBytes = 16 // 32 hex chars
)

// NewID returns a random paste identifier (16 hex chars / 64 bits).
func NewID() (string, error) {
	return randomHex(idBytes)
}

// NewDeleteToken returns a random delete token (32 hex chars / 128 bits).
func NewDeleteToken() (string, error) {
	return randomHex(deleteTokenBytes)
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
