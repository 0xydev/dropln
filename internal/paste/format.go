// Package paste implements PrivateBin Format v2: the on-the-wire representation
// of an encrypted paste. The server never sees plaintext or keys; this package
// only validates the envelope and supports marshaling for storage and transport.
package paste

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

const FormatVersion = 2

const (
	minIterations = 10001 // PHP rule: > 10000
	maxIVBase64   = 24
	maxSaltBase64 = 14
)

var (
	validKeySizes    = map[int]struct{}{128: {}, 192: {}, 256: {}}
	validTagSizes    = map[int]struct{}{64: {}, 96: {}, 128: {}}
	validModes       = map[string]struct{}{"ctr": {}, "cbc": {}, "gcm": {}}
	validCompression = map[string]struct{}{"zlib": {}, "none": {}}
	pasteTopKeys     = map[string]struct{}{"v": {}, "ct": {}, "adata": {}, "meta": {}}
	commentTopKeys   = map[string]struct{}{"v": {}, "ct": {}, "adata": {}, "pasteid": {}, "parentid": {}}
)

// Formatter selects how the decrypted text is rendered client-side.
// PrivateBin treats this field as opaque on the server (no validation),
// so we mirror that: any string is accepted.
type Formatter string

const (
	FormatterPlaintext          Formatter = "plaintext"
	FormatterSyntaxHighlighting Formatter = "syntaxhighlighting"
	FormatterMarkdown           Formatter = "markdown"
)

// CipherParams is the crypto envelope.
// Wire shape: [iv, salt, iterations, keysize, tagsize, algorithm, mode, compression]
type CipherParams struct {
	IV          string
	Salt        string
	Iterations  int
	KeySize     int
	TagSize     int
	Algorithm   string
	Mode        string
	Compression string
}

func (c CipherParams) MarshalJSON() ([]byte, error) {
	return json.Marshal([]any{
		c.IV, c.Salt, c.Iterations, c.KeySize, c.TagSize,
		c.Algorithm, c.Mode, c.Compression,
	})
}

func (c *CipherParams) UnmarshalJSON(data []byte) error {
	var raw []json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("cipher params: %w", err)
	}
	if len(raw) != 8 {
		return fmt.Errorf("cipher params: expected 8 elements, got %d", len(raw))
	}
	targets := []any{&c.IV, &c.Salt, &c.Iterations, &c.KeySize, &c.TagSize, &c.Algorithm, &c.Mode, &c.Compression}
	names := []string{"iv", "salt", "iterations", "keysize", "tagsize", "algorithm", "mode", "compression"}
	for i, t := range targets {
		if err := json.Unmarshal(raw[i], t); err != nil {
			return fmt.Errorf("cipher params[%d] %s: %w", i, names[i], err)
		}
	}
	return nil
}

// AssociatedData carries the authenticated metadata.
// Wire shape: [cipher_params, formatter, open_discussion, burn_after_read]
type AssociatedData struct {
	Cipher         CipherParams
	Formatter      Formatter
	OpenDiscussion bool
	BurnAfterRead  bool
}

func (a AssociatedData) MarshalJSON() ([]byte, error) {
	return json.Marshal([]any{a.Cipher, string(a.Formatter), boolToInt(a.OpenDiscussion), boolToInt(a.BurnAfterRead)})
}

func (a *AssociatedData) UnmarshalJSON(data []byte) error {
	var raw []json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("adata: %w", err)
	}
	if len(raw) != 4 {
		return fmt.Errorf("adata: expected 4 elements, got %d", len(raw))
	}
	if err := json.Unmarshal(raw[0], &a.Cipher); err != nil {
		return fmt.Errorf("adata[0] cipher: %w", err)
	}
	var fm string
	if err := json.Unmarshal(raw[1], &fm); err != nil {
		return fmt.Errorf("adata[1] formatter: %w", err)
	}
	a.Formatter = Formatter(fm)
	var od int
	if err := json.Unmarshal(raw[2], &od); err != nil {
		return fmt.Errorf("adata[2] open_discussion: %w", err)
	}
	a.OpenDiscussion = od != 0
	var bar int
	if err := json.Unmarshal(raw[3], &bar); err != nil {
		return fmt.Errorf("adata[3] burn_after_read: %w", err)
	}
	a.BurnAfterRead = bar != 0
	return nil
}

// Meta carries unauthenticated paste metadata. For pastes, only "expire" is allowed.
type Meta struct {
	Expire string `json:"expire"`
}

func (m *Meta) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("meta: %w", err)
	}
	if len(raw) != 1 {
		return fmt.Errorf("meta: expected exactly 1 key, got %d", len(raw))
	}
	expireRaw, ok := raw["expire"]
	if !ok {
		return errors.New(`meta: missing required key "expire"`)
	}
	return json.Unmarshal(expireRaw, &m.Expire)
}

// Payload is the Format v2 envelope.
type Payload struct {
	Version    float64        `json:"v"`
	Ciphertext string         `json:"ct"`
	ADATA      AssociatedData `json:"adata"`
	Meta       Meta           `json:"meta"`
}

// Decode parses a Format v2 paste payload and runs Validate.
// It enforces the strict "exactly 4 top-level keys" rule.
func Decode(data []byte) (*Payload, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(data, &top); err != nil {
		return nil, fmt.Errorf("payload: %w", err)
	}
	if len(top) != 4 {
		return nil, fmt.Errorf("payload: expected 4 keys, got %d", len(top))
	}
	for k := range top {
		if _, ok := pasteTopKeys[k]; !ok {
			return nil, fmt.Errorf("payload: unknown key %q", k)
		}
	}
	var p Payload
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("payload: %w", err)
	}
	if err := p.Validate(); err != nil {
		return nil, err
	}
	return &p, nil
}

// Validate enforces all FormatV2 rules for a paste.
func (p *Payload) Validate() error {
	if p.Version < FormatVersion {
		return fmt.Errorf("version: must be >= %d, got %v", FormatVersion, p.Version)
	}
	if err := validateCipherParams(p.ADATA.Cipher); err != nil {
		return err
	}
	if err := validateCiphertext(p.Ciphertext); err != nil {
		return err
	}
	if p.Meta.Expire == "" {
		return errors.New(`meta.expire: required`)
	}
	return nil
}

// validateCipherParams enforces the algorithm/mode/size rules from FormatV2.
// Used by both paste and comment validators.
func validateCipherParams(c CipherParams) error {
	if n := len(c.IV); n == 0 || n > maxIVBase64 {
		return fmt.Errorf("iv: length must be 1..%d, got %d", maxIVBase64, n)
	}
	if _, err := base64.StdEncoding.DecodeString(c.IV); err != nil {
		return fmt.Errorf("iv: invalid base64: %w", err)
	}
	if n := len(c.Salt); n == 0 || n > maxSaltBase64 {
		return fmt.Errorf("salt: length must be 1..%d, got %d", maxSaltBase64, n)
	}
	if _, err := base64.StdEncoding.DecodeString(c.Salt); err != nil {
		return fmt.Errorf("salt: invalid base64: %w", err)
	}
	if c.Iterations < minIterations {
		return fmt.Errorf("iterations: must be > %d, got %d", minIterations-1, c.Iterations)
	}
	if _, ok := validKeySizes[c.KeySize]; !ok {
		return fmt.Errorf("keysize: must be 128, 192, or 256, got %d", c.KeySize)
	}
	if _, ok := validTagSizes[c.TagSize]; !ok {
		return fmt.Errorf("tagsize: must be 64, 96, or 128, got %d", c.TagSize)
	}
	if c.Algorithm != "aes" {
		return fmt.Errorf("algorithm: must be %q, got %q", "aes", c.Algorithm)
	}
	if _, ok := validModes[c.Mode]; !ok {
		return fmt.Errorf("mode: must be ctr, cbc, or gcm, got %q", c.Mode)
	}
	if _, ok := validCompression[c.Compression]; !ok {
		return fmt.Errorf("compression: must be zlib or none, got %q", c.Compression)
	}
	return nil
}

// validateCiphertext checks ct is valid base64 and not pathologically
// compressible (entropy floor — properly encrypted bytes should not deflate
// smaller than themselves).
func validateCiphertext(ct64 string) error {
	ct, err := base64.StdEncoding.DecodeString(ct64)
	if err != nil {
		return fmt.Errorf("ct: invalid base64: %w", err)
	}
	if len(ct) == 0 {
		return errors.New("ct: empty")
	}
	deflated, err := deflateLen(ct)
	if err != nil {
		return fmt.Errorf("ct entropy check: %w", err)
	}
	if len(ct) > deflated {
		return errors.New("ct: entropy too low (compressible)")
	}
	return nil
}

// CommentPayload is the Format v2 envelope for a comment. Differs from a
// paste in two ways: adata is flat cipher params (not nested with formatter
// flags), and pasteid/parentid replace the paste's meta block.
type CommentPayload struct {
	Version    float64      `json:"v"`
	Ciphertext string       `json:"ct"`
	ADATA      CipherParams `json:"adata"`
	PasteID    string       `json:"pasteid"`
	ParentID   string       `json:"parentid"`
}

// DecodeComment parses a Format v2 comment payload and validates it.
func DecodeComment(data []byte) (*CommentPayload, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(data, &top); err != nil {
		return nil, fmt.Errorf("comment: %w", err)
	}
	if len(top) != 5 {
		return nil, fmt.Errorf("comment: expected 5 keys, got %d", len(top))
	}
	for k := range top {
		if _, ok := commentTopKeys[k]; !ok {
			return nil, fmt.Errorf("comment: unknown key %q", k)
		}
	}
	var c CommentPayload
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("comment: %w", err)
	}
	if err := c.Validate(); err != nil {
		return nil, err
	}
	return &c, nil
}

// Validate enforces FormatV2 rules for a comment.
func (c *CommentPayload) Validate() error {
	if c.Version < FormatVersion {
		return fmt.Errorf("version: must be >= %d, got %v", FormatVersion, c.Version)
	}
	if err := validateCipherParams(c.ADATA); err != nil {
		return err
	}
	if err := validateCiphertext(c.Ciphertext); err != nil {
		return err
	}
	if !ValidID(c.PasteID) {
		return errors.New("pasteid: must be 16 lowercase hex chars")
	}
	if !ValidID(c.ParentID) {
		return errors.New("parentid: must be 16 lowercase hex chars")
	}
	return nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func deflateLen(data []byte) (int, error) {
	var buf bytes.Buffer
	w, err := flate.NewWriter(&buf, flate.DefaultCompression)
	if err != nil {
		return 0, err
	}
	if _, err := io.Copy(w, bytes.NewReader(data)); err != nil {
		_ = w.Close()
		return 0, err
	}
	if err := w.Close(); err != nil {
		return 0, err
	}
	return buf.Len(), nil
}
