package server_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/0xydev/ulakbin/internal/config"
	"github.com/0xydev/ulakbin/internal/ratelimit"
	"github.com/0xydev/ulakbin/internal/server"
	"github.com/0xydev/ulakbin/internal/storage/postgres"
)

const validPayload = `{"v":2,"ct":"ME5JF/YBEijp2uYMzLZozbKtWc5wfy6R59NBb7SmRig=","adata":[["gMSNoLOk4z0RnmsYwXZ8mw==","TZO+JWuIuxs=",100000,256,128,"aes","gcm","zlib"],"plaintext",1,0],"meta":{"expire":"5min"}}`

func commentForPaste(pasteID string) string {
	return `{"v":2,"ct":"ME5JF/YBEijp2uYMzLZozbKtWc5wfy6R59NBb7SmRig=","adata":["gMSNoLOk4z0RnmsYwXZ8mw==","TZO+JWuIuxs=",100000,256,128,"aes","gcm","zlib"],"pasteid":"` + pasteID + `","parentid":"` + pasteID + `"}`
}

func createPaste(t *testing.T, srv http.Handler) (id, deleteToken string) {
	t.Helper()
	req := httptest.NewRequest("POST", "/api/v1/paste", strings.NewReader(validPayload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("createPaste: got %d, body %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		ID          string `json:"id"`
		DeleteToken string `json:"delete_token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("createPaste body: %v", err)
	}
	return resp.ID, resp.DeleteToken
}

func setup(t *testing.T) (http.Handler, *config.Config) {
	t.Helper()
	dsn := os.Getenv("ULAKBIN_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set ULAKBIN_TEST_DATABASE_URL to run server integration tests")
	}
	ctx := context.Background()
	store, err := postgres.New(ctx, dsn)
	if err != nil {
		t.Fatalf("postgres.New: %v", err)
	}
	t.Cleanup(store.Close)

	cfg := &config.Config{
		Addr:            ":0",
		DatabaseURL:     dsn,
		MaxPasteBytes:   2048, // small limit for the size test
		PurgeInterval:   time.Minute,
		PurgeBatchSize:  100,
		RateLimitPerMin: 100000, // effectively disabled
		RateLimitBurst:  100000,
		RateLimitTTL:    time.Hour,
	}

	limiter := ratelimit.New(cfg.RateLimitPerMin, cfg.RateLimitBurst, cfg.RateLimitTTL)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := server.New(cfg, logger, store, limiter)
	return srv, cfg
}

func TestInfo(t *testing.T) {
	srv, cfg := setup(t)

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/info", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body: %s", rec.Code, rec.Body.String())
	}

	var body struct {
		Version          string   `json:"version"`
		MaxPasteBytes    int64    `json:"max_paste_bytes"`
		ExpireOptions    []string `json:"expire_options"`
		FormatterOptions []string `json:"formatter_options"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body.Version == "" {
		t.Error("version: empty")
	}
	if body.MaxPasteBytes != cfg.MaxPasteBytes {
		t.Errorf("max_paste_bytes: got %d, want %d", body.MaxPasteBytes, cfg.MaxPasteBytes)
	}
	if len(body.ExpireOptions) < 5 {
		t.Errorf("expire_options too short: %v", body.ExpireOptions)
	}
	wantFormatters := map[string]bool{"plaintext": false, "syntaxhighlighting": false, "markdown": false}
	for _, f := range body.FormatterOptions {
		if _, ok := wantFormatters[f]; ok {
			wantFormatters[f] = true
		}
	}
	for f, seen := range wantFormatters {
		if !seen {
			t.Errorf("formatter_options missing %q", f)
		}
	}
}

func TestCreate_TooLarge(t *testing.T) {
	srv, cfg := setup(t)

	// Body double the limit; doesn't need to be valid JSON — the size check
	// fires before any payload parsing.
	bigBody := strings.Repeat("x", int(cfg.MaxPasteBytes*2))
	req := httptest.NewRequest("POST", "/api/v1/paste", strings.NewReader(bigBody))
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status: got %d, want 413; body: %s", rec.Code, rec.Body.String())
	}
}

func TestSecurityHeaders(t *testing.T) {
	srv, _ := setup(t)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest("GET", "/healthz", nil))

	wantHeaders := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "no-referrer",
	}
	for k, v := range wantHeaders {
		if got := rec.Header().Get(k); got != v {
			t.Errorf("header %s: got %q, want %q", k, got, v)
		}
	}
	if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'none'") {
		t.Errorf("CSP missing or weak: %q", csp)
	}
}

func TestComment_HappyPath(t *testing.T) {
	srv, _ := setup(t)
	pasteID, _ := createPaste(t, srv)

	body := commentForPaste(pasteID)
	req := httptest.NewRequest("POST", "/api/v1/paste/"+pasteID+"/comment", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create comment: got %d, body %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil || resp.ID == "" {
		t.Fatalf("comment id missing: err=%v body=%s", err, rec.Body.String())
	}

	// List should include the comment with `id` and `created` spliced in.
	listRec := httptest.NewRecorder()
	srv.ServeHTTP(listRec, httptest.NewRequest("GET", "/api/v1/paste/"+pasteID+"/comments", nil))
	if listRec.Code != http.StatusOK {
		t.Fatalf("list comments: got %d, body %s", listRec.Code, listRec.Body.String())
	}
	var list []map[string]any
	if err := json.Unmarshal(listRec.Body.Bytes(), &list); err != nil {
		t.Fatalf("list body: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("got %d comments, want 1", len(list))
	}
	if list[0]["id"] != resp.ID {
		t.Errorf("listed id mismatch: got %v, want %v", list[0]["id"], resp.ID)
	}
	if _, ok := list[0]["created"].(float64); !ok {
		t.Errorf(`"created" missing or wrong type: %T`, list[0]["created"])
	}
	// Original envelope keys must still be there.
	for _, k := range []string{"v", "ct", "adata", "pasteid", "parentid"} {
		if _, ok := list[0][k]; !ok {
			t.Errorf("listed comment missing %q", k)
		}
	}
}

func TestComment_ParentMissing(t *testing.T) {
	srv, _ := setup(t)
	missing := "0123456789abcdef"
	body := commentForPaste(missing)
	req := httptest.NewRequest("POST", "/api/v1/paste/"+missing+"/comment", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("got %d, want 404", rec.Code)
	}
}

func TestComment_PasteIDMismatch(t *testing.T) {
	srv, _ := setup(t)
	pasteID, _ := createPaste(t, srv)

	// Body claims a different paste id.
	body := commentForPaste("0000000000000000")
	req := httptest.NewRequest("POST", "/api/v1/paste/"+pasteID+"/comment", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("got %d, want 422", rec.Code)
	}
}

func TestComment_ListEmpty(t *testing.T) {
	srv, _ := setup(t)
	pasteID, _ := createPaste(t, srv)

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/paste/"+pasteID+"/comments", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d", rec.Code)
	}
	body := strings.TrimSpace(rec.Body.String())
	if body != "[]" {
		t.Errorf("expected [], got %q", body)
	}
}

func TestCreateReadDelete_HappyPath(t *testing.T) {
	srv, _ := setup(t)

	// Create
	createReq := httptest.NewRequest("POST", "/api/v1/paste", strings.NewReader(validPayload))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	srv.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create: got %d, body %s", createRec.Code, createRec.Body.String())
	}
	var created struct {
		ID          string `json:"id"`
		DeleteToken string `json:"delete_token"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &created); err != nil {
		t.Fatalf("create body: %v", err)
	}

	// Read
	readRec := httptest.NewRecorder()
	srv.ServeHTTP(readRec, httptest.NewRequest("GET", "/api/v1/paste/"+created.ID, nil))
	if readRec.Code != http.StatusOK {
		t.Fatalf("read: got %d, body %s", readRec.Code, readRec.Body.String())
	}
	if readRec.Body.String() != validPayload {
		t.Errorf("read: payload not byte-identical to create")
	}

	// Delete (correct token → 204)
	delReq := httptest.NewRequest("DELETE", "/api/v1/paste/"+created.ID+"?token="+created.DeleteToken, nil)
	delRec := httptest.NewRecorder()
	srv.ServeHTTP(delRec, delReq)
	if delRec.Code != http.StatusNoContent {
		t.Errorf("delete: got %d, want 204", delRec.Code)
	}

	// Read after delete (404)
	readAfter := httptest.NewRecorder()
	srv.ServeHTTP(readAfter, httptest.NewRequest("GET", "/api/v1/paste/"+created.ID, nil))
	if readAfter.Code != http.StatusNotFound {
		t.Errorf("read-after-delete: got %d, want 404", readAfter.Code)
	}
}
