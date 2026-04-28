package paste

import (
	"encoding/json"
	"strings"
	"testing"
)

// samplePasteJSON is taken verbatim from PrivateBin's tst/Bootstrap.php $pasteV2.
// Keeping it byte-compatible guarantees the JS frontend's payloads validate here.
const samplePasteJSON = `{
  "v": 2,
  "ct": "ME5JF/YBEijp2uYMzLZozbKtWc5wfy6R59NBb7SmRig=",
  "adata": [
    ["gMSNoLOk4z0RnmsYwXZ8mw==", "TZO+JWuIuxs=", 100000, 256, 128, "aes", "gcm", "zlib"],
    "plaintext",
    1,
    0
  ],
  "meta": {"expire": "5min"}
}`

func TestDecode_Sample(t *testing.T) {
	p, err := Decode([]byte(samplePasteJSON))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.Version != 2 {
		t.Errorf("version: got %v, want 2", p.Version)
	}
	if p.ADATA.Cipher.Algorithm != "aes" || p.ADATA.Cipher.Mode != "gcm" {
		t.Errorf("cipher: got %s/%s, want aes/gcm", p.ADATA.Cipher.Algorithm, p.ADATA.Cipher.Mode)
	}
	if p.ADATA.Cipher.KeySize != 256 || p.ADATA.Cipher.TagSize != 128 {
		t.Errorf("cipher sizes: got %d/%d, want 256/128", p.ADATA.Cipher.KeySize, p.ADATA.Cipher.TagSize)
	}
	if p.ADATA.Cipher.Iterations != 100000 {
		t.Errorf("iterations: got %d, want 100000", p.ADATA.Cipher.Iterations)
	}
	if p.ADATA.Formatter != FormatterPlaintext {
		t.Errorf("formatter: got %q, want %q", p.ADATA.Formatter, FormatterPlaintext)
	}
	if !p.ADATA.OpenDiscussion {
		t.Error("open_discussion: want true")
	}
	if p.ADATA.BurnAfterRead {
		t.Error("burn_after_read: want false")
	}
	if p.Meta.Expire != "5min" {
		t.Errorf("expire: got %q, want %q", p.Meta.Expire, "5min")
	}
}

func TestRoundTrip(t *testing.T) {
	p1, err := Decode([]byte(samplePasteJSON))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	out, err := json.Marshal(p1)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	p2, err := Decode(out)
	if err != nil {
		t.Fatalf("re-decode: %v\noutput was: %s", err, out)
	}
	if *p1 != *p2 {
		t.Errorf("round-trip mismatch:\n got=%+v\nwant=%+v", p2, p1)
	}
}

func TestDecode_Rejections(t *testing.T) {
	// Each case: a JSON-patched copy of the sample paste that should fail validation.
	type tweak func(map[string]any)
	cases := []struct {
		name   string
		tweak  tweak
		expect string // substring expected in error
	}{
		{
			name:   "invalid base64 iv",
			tweak:  func(m map[string]any) { adata(m)[0].([]any)[0] = "$" },
			expect: "iv",
		},
		{
			name:   "invalid base64 salt",
			tweak:  func(m map[string]any) { adata(m)[0].([]any)[1] = "$" },
			expect: "salt",
		},
		{
			name:   "invalid base64 ct",
			tweak:  func(m map[string]any) { m["ct"] = "$" },
			expect: "ct",
		},
		{
			name:   "low entropy ct",
			tweak:  func(m map[string]any) { m["ct"] = "bm9kYXRhbm9kYXRhbm9kYXRhbm9kYXRhbm9kYXRhCg==" },
			expect: "entropy",
		},
		{
			name:   "iv too long",
			tweak:  func(m map[string]any) { adata(m)[0].([]any)[0] = "MTIzNDU2Nzg5MDEyMzQ1Njc4OTA=" },
			expect: "iv",
		},
		{
			name:   "salt too long",
			tweak:  func(m map[string]any) { adata(m)[0].([]any)[1] = "MTIzNDU2Nzg5MDEyMzQ1Njc4OTA=" },
			expect: "salt",
		},
		{
			name:   "extra top-level key",
			tweak:  func(m map[string]any) { m["foo"] = "bar" },
			expect: "5",
		},
		{
			name:   "missing top-level key",
			tweak:  func(m map[string]any) { delete(m, "meta") },
			expect: "3",
		},
		{
			name:   "version too low",
			tweak:  func(m map[string]any) { m["v"] = 0.9 },
			expect: "version",
		},
		{
			name:   "iterations too low",
			tweak:  func(m map[string]any) { adata(m)[0].([]any)[2] = 1000 },
			expect: "iterations",
		},
		{
			name:   "invalid keysize",
			tweak:  func(m map[string]any) { adata(m)[0].([]any)[3] = 127 },
			expect: "keysize",
		},
		{
			name:   "invalid tagsize",
			tweak:  func(m map[string]any) { adata(m)[0].([]any)[4] = 63 },
			expect: "tagsize",
		},
		{
			name:   "invalid algorithm",
			tweak:  func(m map[string]any) { adata(m)[0].([]any)[5] = "!#@" },
			expect: "algorithm",
		},
		{
			name:   "invalid mode",
			tweak:  func(m map[string]any) { adata(m)[0].([]any)[6] = "!#@" },
			expect: "mode",
		},
		{
			name:   "invalid compression",
			tweak:  func(m map[string]any) { adata(m)[0].([]any)[7] = "!#@" },
			expect: "compression",
		},
		{
			name: "extra meta key",
			tweak: func(m map[string]any) {
				m["meta"] = map[string]any{"expire": "5min", "salt": "abc"}
			},
			expect: "meta",
		},
		{
			name: "missing meta.expire",
			tweak: func(m map[string]any) {
				m["meta"] = map[string]any{"foo": "bar"}
			},
			expect: "meta",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var m map[string]any
			if err := json.Unmarshal([]byte(samplePasteJSON), &m); err != nil {
				t.Fatalf("unmarshal sample: %v", err)
			}
			tc.tweak(m)
			data, err := json.Marshal(m)
			if err != nil {
				t.Fatalf("re-marshal: %v", err)
			}
			_, err = Decode(data)
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.expect)
			}
			if !strings.Contains(err.Error(), tc.expect) {
				t.Errorf("expected error containing %q, got: %v", tc.expect, err)
			}
		})
	}
}

func adata(m map[string]any) []any {
	return m["adata"].([]any)
}

// sampleCommentJSON is the comment shape PrivateBin's tst/Bootstrap.php
// produces in getCommentPost(): same crypto envelope as a paste, but adata
// is the flat cipher_params and pasteid/parentid replace meta.
const sampleCommentJSON = `{
  "v": 2,
  "ct": "ME5JF/YBEijp2uYMzLZozbKtWc5wfy6R59NBb7SmRig=",
  "adata": ["gMSNoLOk4z0RnmsYwXZ8mw==","TZO+JWuIuxs=",100000,256,128,"aes","gcm","zlib"],
  "pasteid": "0123456789abcdef",
  "parentid": "0123456789abcdef"
}`

func TestDecodeComment_Sample(t *testing.T) {
	c, err := DecodeComment([]byte(sampleCommentJSON))
	if err != nil {
		t.Fatalf("decode comment: %v", err)
	}
	if c.Version != 2 {
		t.Errorf("version: got %v, want 2", c.Version)
	}
	if c.PasteID != "0123456789abcdef" || c.ParentID != "0123456789abcdef" {
		t.Errorf("ids: got %q/%q", c.PasteID, c.ParentID)
	}
	if c.ADATA.Algorithm != "aes" || c.ADATA.Mode != "gcm" {
		t.Errorf("cipher: got %s/%s", c.ADATA.Algorithm, c.ADATA.Mode)
	}
}

func TestCommentRoundTrip(t *testing.T) {
	c1, err := DecodeComment([]byte(sampleCommentJSON))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	out, err := json.Marshal(c1)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	c2, err := DecodeComment(out)
	if err != nil {
		t.Fatalf("re-decode: %v\noutput was: %s", err, out)
	}
	if *c1 != *c2 {
		t.Errorf("round-trip mismatch:\n got=%+v\nwant=%+v", c2, c1)
	}
}

func TestDecodeComment_Rejections(t *testing.T) {
	type tweak func(map[string]any)
	cases := []struct {
		name   string
		tweak  tweak
		expect string
	}{
		{
			name:   "extra top-level key",
			tweak:  func(m map[string]any) { m["meta"] = map[string]any{} },
			expect: "6",
		},
		{
			name:   "missing parentid",
			tweak:  func(m map[string]any) { delete(m, "parentid") },
			expect: "4",
		},
		{
			name:   "invalid pasteid",
			tweak:  func(m map[string]any) { m["pasteid"] = "not-hex" },
			expect: "pasteid",
		},
		{
			name:   "uppercase pasteid",
			tweak:  func(m map[string]any) { m["pasteid"] = "0123456789ABCDEF" },
			expect: "pasteid",
		},
		{
			name:   "invalid parentid",
			tweak:  func(m map[string]any) { m["parentid"] = "short" },
			expect: "parentid",
		},
		{
			name:   "invalid base64 ct",
			tweak:  func(m map[string]any) { m["ct"] = "$" },
			expect: "ct",
		},
		{
			name:   "low entropy ct",
			tweak:  func(m map[string]any) { m["ct"] = "bm9kYXRhbm9kYXRhbm9kYXRhbm9kYXRhbm9kYXRhCg==" },
			expect: "entropy",
		},
		{
			name: "invalid iv (in flat adata)",
			tweak: func(m map[string]any) {
				m["adata"].([]any)[0] = "$"
			},
			expect: "iv",
		},
		{
			name: "iterations too low",
			tweak: func(m map[string]any) {
				m["adata"].([]any)[2] = 1000
			},
			expect: "iterations",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var m map[string]any
			if err := json.Unmarshal([]byte(sampleCommentJSON), &m); err != nil {
				t.Fatalf("unmarshal sample: %v", err)
			}
			tc.tweak(m)
			data, err := json.Marshal(m)
			if err != nil {
				t.Fatalf("re-marshal: %v", err)
			}
			_, err = DecodeComment(data)
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.expect)
			}
			if !strings.Contains(err.Error(), tc.expect) {
				t.Errorf("expected error containing %q, got: %v", tc.expect, err)
			}
		})
	}
}
