// Package clientcrypto is the Go-side counterpart of web/src/crypto. It
// produces and consumes Format v2 envelopes byte-compatible with the
// browser implementation, so a paste created from the CLI decrypts in the
// web UI and vice versa.
//
// AES-256-GCM, PBKDF2-SHA256 (100k), 16-byte IV, 8-byte salt, 32-byte raw
// key. Plaintext is JSON of {paste, attachment?, attachment_name?},
// optionally zlib-compressed (RFC 1950) before encryption. AAD is the
// JSON-marshaled adata block — identical to JS's JSON.stringify(adata)
// because both encode integers, strings, and arrays the same way for our
// shape.
package clientcrypto

import (
	"bytes"
	"compress/zlib"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"golang.org/x/crypto/pbkdf2"

	"github.com/0xydev/ulakbin/internal/paste"
)

const (
	Iterations  = 100000
	KeyBits     = 256
	TagBits     = 128
	IVBytes     = 16
	SaltBytes   = 8
	RawKeyBytes = 32
)

// PlainPaste mirrors the browser-side shape: the encrypted blob is the
// JSON of this struct.
type PlainPaste struct {
	Paste          string `json:"paste"`
	Attachment     string `json:"attachment,omitempty"`
	AttachmentName string `json:"attachment_name,omitempty"`
}

// EncryptOpts controls a single Encrypt call.
type EncryptOpts struct {
	Plaintext      PlainPaste
	Password       string
	Expire         string         // "5min", "10min", "1hour", ..., "never"
	Formatter      paste.Formatter // "plaintext" | "syntaxhighlighting" | "markdown"
	BurnAfterRead  bool
	OpenDiscussion bool
	// Compression: "zlib" (default) or "none". The decryptor honors the
	// per-envelope flag, so old "none" pastes still decrypt cleanly.
	Compression string
}

// EncryptResult is what the CLI sends to the server (Envelope) plus the
// raw key (URL-safe base64 of the 32 random bytes) for the URL fragment.
type EncryptResult struct {
	Envelope  paste.Payload
	KeyB64Url string
}

// Encrypt produces a paste envelope and the URL fragment key.
func Encrypt(opts EncryptOpts) (*EncryptResult, error) {
	rawKey, err := randomBytes(RawKeyBytes)
	if err != nil {
		return nil, fmt.Errorf("rng key: %w", err)
	}
	iv, err := randomBytes(IVBytes)
	if err != nil {
		return nil, fmt.Errorf("rng iv: %w", err)
	}
	salt, err := randomBytes(SaltBytes)
	if err != nil {
		return nil, fmt.Errorf("rng salt: %w", err)
	}

	compression := opts.Compression
	if compression == "" {
		compression = "zlib"
	}

	cipherParams := paste.CipherParams{
		IV:          base64.StdEncoding.EncodeToString(iv),
		Salt:        base64.StdEncoding.EncodeToString(salt),
		Iterations:  Iterations,
		KeySize:     KeyBits,
		TagSize:     TagBits,
		Algorithm:   "aes",
		Mode:        "gcm",
		Compression: compression,
	}

	formatter := opts.Formatter
	if formatter == "" {
		formatter = paste.FormatterPlaintext
	}

	adata := paste.AssociatedData{
		Cipher:         cipherParams,
		Formatter:      formatter,
		OpenDiscussion: opts.OpenDiscussion,
		BurnAfterRead:  opts.BurnAfterRead,
	}

	derivedKey := deriveKey(rawKey, opts.Password, salt, Iterations)

	aadBytes, err := json.Marshal(adata)
	if err != nil {
		return nil, fmt.Errorf("marshal adata: %w", err)
	}

	plaintextBytes, err := json.Marshal(opts.Plaintext)
	if err != nil {
		return nil, fmt.Errorf("marshal plaintext: %w", err)
	}
	if compression == "zlib" {
		plaintextBytes, err = zlibCompress(plaintextBytes)
		if err != nil {
			return nil, fmt.Errorf("compress: %w", err)
		}
	}

	ct, err := aesGcmSeal(derivedKey, iv, aadBytes, plaintextBytes)
	if err != nil {
		return nil, fmt.Errorf("encrypt: %w", err)
	}

	envelope := paste.Payload{
		Version:    paste.FormatVersion,
		Ciphertext: base64.StdEncoding.EncodeToString(ct),
		ADATA:      adata,
		Meta:       paste.Meta{Expire: opts.Expire},
	}

	return &EncryptResult{
		Envelope:  envelope,
		KeyB64Url: base64.RawURLEncoding.EncodeToString(rawKey),
	}, nil
}

// Decrypt reverses Encrypt. Honors the envelope's compression flag, so it
// transparently handles both "zlib" and "none" pastes.
func Decrypt(envelope paste.Payload, keyB64Url, password string) (*PlainPaste, error) {
	c := envelope.ADATA.Cipher

	iv, err := base64.StdEncoding.DecodeString(c.IV)
	if err != nil {
		return nil, fmt.Errorf("iv: %w", err)
	}
	salt, err := base64.StdEncoding.DecodeString(c.Salt)
	if err != nil {
		return nil, fmt.Errorf("salt: %w", err)
	}

	rawKey, err := base64.RawURLEncoding.DecodeString(keyB64Url)
	if err != nil {
		// Tolerate URLs with stray padding.
		if k, e2 := base64.URLEncoding.DecodeString(keyB64Url); e2 == nil {
			rawKey = k
		} else {
			return nil, fmt.Errorf("url key: %w", err)
		}
	}
	if len(rawKey) != RawKeyBytes {
		return nil, fmt.Errorf("expected %d-byte key, got %d", RawKeyBytes, len(rawKey))
	}

	derivedKey := deriveKey(rawKey, password, salt, c.Iterations)

	aadBytes, err := json.Marshal(envelope.ADATA)
	if err != nil {
		return nil, fmt.Errorf("marshal adata: %w", err)
	}

	ct, err := base64.StdEncoding.DecodeString(envelope.Ciphertext)
	if err != nil {
		return nil, fmt.Errorf("ct: %w", err)
	}

	plaintext, err := aesGcmOpen(derivedKey, iv, aadBytes, ct)
	if err != nil {
		return nil, ErrDecryptFailed
	}

	if c.Compression == "zlib" {
		plaintext, err = zlibDecompress(plaintext)
		if err != nil {
			return nil, fmt.Errorf("decompress: %w", err)
		}
	}

	var out PlainPaste
	if err := json.Unmarshal(plaintext, &out); err != nil {
		return nil, fmt.Errorf("unmarshal plaintext: %w", err)
	}
	return &out, nil
}

// ErrDecryptFailed is returned when AES-GCM authentication fails (wrong
// key, wrong password, or tampered ciphertext). The CLI surfaces this as
// a clear "couldn't decrypt" message instead of leaking the raw error.
var ErrDecryptFailed = errors.New("decryption failed — wrong key, wrong password, or corrupt ciphertext")

// ─── primitives ──────────────────────────────────────────────────────────

func randomBytes(n int) ([]byte, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return b, nil
}

// deriveKey replicates the PrivateBin scheme: PBKDF2(rawKey || password,
// salt, iterations) → 32-byte AES-GCM key.
func deriveKey(rawKey []byte, password string, salt []byte, iterations int) []byte {
	material := make([]byte, 0, len(rawKey)+len(password))
	material = append(material, rawKey...)
	material = append(material, []byte(password)...)
	return pbkdf2.Key(material, salt, iterations, KeyBits/8, sha256.New)
}

func aesGcmSeal(key, iv, aad, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCMWithNonceSize(block, len(iv))
	if err != nil {
		return nil, err
	}
	return aead.Seal(nil, iv, plaintext, aad), nil
}

func aesGcmOpen(key, iv, aad, ct []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCMWithNonceSize(block, len(iv))
	if err != nil {
		return nil, err
	}
	return aead.Open(nil, iv, ct, aad)
}

func zlibCompress(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	w := zlib.NewWriter(&buf)
	if _, err := w.Write(data); err != nil {
		_ = w.Close()
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func zlibDecompress(data []byte) ([]byte, error) {
	r, err := zlib.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}
