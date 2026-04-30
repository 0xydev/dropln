package clientcrypto

import (
	"strings"
	"testing"

	"github.com/0xydev/dropln/internal/paste"
)

func TestRoundTrip_Basic(t *testing.T) {
	res, err := Encrypt(EncryptOpts{
		Plaintext: PlainPaste{Paste: "hello dropln"},
		Expire:    "5min",
		Formatter: paste.FormatterPlaintext,
	})
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	got, err := Decrypt(res.Envelope, res.KeyB64Url, "")
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got.Paste != "hello dropln" {
		t.Errorf("paste mismatch: got %q", got.Paste)
	}
}

func TestRoundTrip_WithPassword(t *testing.T) {
	res, err := Encrypt(EncryptOpts{
		Plaintext: PlainPaste{Paste: "secret"},
		Password:  "tr0ub4dor",
		Expire:    "1hour",
		Formatter: paste.FormatterPlaintext,
	})
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	if _, err := Decrypt(res.Envelope, res.KeyB64Url, "wrong"); err == nil {
		t.Error("decrypt with wrong password: want error")
	}
	got, err := Decrypt(res.Envelope, res.KeyB64Url, "tr0ub4dor")
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got.Paste != "secret" {
		t.Errorf("paste mismatch: got %q", got.Paste)
	}
}

func TestRoundTrip_LargeText(t *testing.T) {
	body := strings.Repeat("INFO  request handled in 12ms\n", 10000) // ~310 KB
	res, err := Encrypt(EncryptOpts{
		Plaintext: PlainPaste{Paste: body},
		Expire:    "1day",
		Formatter: paste.FormatterSyntaxHighlighting,
	})
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	// Sanity: zlib should compress this repetitive text by a lot — the
	// envelope's ct should be far smaller than 310 KB despite base64.
	if len(res.Envelope.Ciphertext) > len(body)/4 {
		t.Errorf("ciphertext suspiciously large for repetitive text: %d vs %d input",
			len(res.Envelope.Ciphertext), len(body))
	}

	got, err := Decrypt(res.Envelope, res.KeyB64Url, "")
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got.Paste != body {
		t.Errorf("paste mismatch: large text round-trip failed")
	}
}

func TestRoundTrip_NoCompression(t *testing.T) {
	res, err := Encrypt(EncryptOpts{
		Plaintext:   PlainPaste{Paste: "tiny"},
		Expire:      "5min",
		Formatter:   paste.FormatterPlaintext,
		Compression: "none",
	})
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if res.Envelope.ADATA.Cipher.Compression != "none" {
		t.Errorf("compression flag: got %q, want none", res.Envelope.ADATA.Cipher.Compression)
	}

	got, err := Decrypt(res.Envelope, res.KeyB64Url, "")
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got.Paste != "tiny" {
		t.Errorf("paste mismatch")
	}
}

func TestRoundTrip_WithAttachment(t *testing.T) {
	res, err := Encrypt(EncryptOpts{
		Plaintext: PlainPaste{
			Paste:          "see attached",
			Attachment:     "data:text/plain;base64,aGVsbG8=", // "hello"
			AttachmentName: "note.txt",
		},
		Expire:    "1day",
		Formatter: paste.FormatterPlaintext,
	})
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	got, err := Decrypt(res.Envelope, res.KeyB64Url, "")
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got.Paste != "see attached" || got.Attachment == "" || got.AttachmentName != "note.txt" {
		t.Errorf("attachment round-trip mismatch: %+v", got)
	}
}

// Decode is what the server's paste.Decode does — feeding our envelope
// through it confirms our encoder produces a byte-valid Format v2 payload.
func TestEncryptedEnvelope_PassesServerValidator(t *testing.T) {
	res, err := Encrypt(EncryptOpts{
		Plaintext:      PlainPaste{Paste: "validated"},
		Expire:         "1hour",
		Formatter:      paste.FormatterSyntaxHighlighting,
		BurnAfterRead:  true,
		OpenDiscussion: true,
	})
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	// Marshal the way the CLI would POST it, then run the server's strict
	// Decode (which checks format, key set, base64-ness, entropy, etc.).
	wire, err := jsonMarshal(res.Envelope)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	parsed, err := paste.Decode(wire)
	if err != nil {
		t.Fatalf("server validator rejected our envelope: %v\nwire=%s", err, wire)
	}
	if !parsed.ADATA.BurnAfterRead || !parsed.ADATA.OpenDiscussion {
		t.Errorf("flags lost in round-trip: %+v", parsed.ADATA)
	}
}
