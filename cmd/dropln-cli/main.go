// dropln — CLI client for the dropln paste server.
//
// Common flows:
//
//   echo "hello" | dropln                    # stdin → URL
//   cat error.log | dropln --burn            # one-time-read URL
//   dropln --file diagram.png                # attachment → URL
//   dropln abc123def456789a#KEY              # fetch & decrypt → stdout
//   dropln https://dropln.example.com/p/abc/#KEY
//
// All crypto happens here in the CLI; the server only sees ciphertext.
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/0xydev/dropln/internal/clientcrypto"
	"github.com/0xydev/dropln/internal/paste"
)

// Version is overridable at build time:
//
//	go build -ldflags "-X main.Version=$(git describe --tags --always)"
var Version = "dev"

const helpText = `dropln — encrypted ephemeral paste

USAGE
  dropln                              read paste content from stdin → URL
  dropln <ref>                        fetch & decrypt (ref = id#key or full URL)
  dropln --file PATH                  attach a file → URL
  dropln delete <id> [token]          delete a paste (uses cached token if omitted)
  dropln list                         list pastes you've created locally

CREATE FLAGS
  --server URL          server endpoint (env DROPLN_SERVER, default http://localhost:8080)
  --expire WIN          5min|10min|1hour|1day|1week|1month|1year|never (default 1day)
  --burn                one-time-read paste (URL gets #- warning prefix)
  --password PW         password protect (combined with URL key via PBKDF2)
  --file PATH           attach file (in addition to or instead of stdin)
  --format FMT          plaintext | syntaxhighlighting | markdown (default plaintext)
  --no-discussion       disable comments on this paste
  --copy                also copy resulting URL to clipboard
  --note TEXT           remember a note for this paste in local history
  --quiet, -q           print only the URL

FETCH FLAGS
  --extract DIR         save attachment to DIR (default: cwd)
  --output FILE         write paste text to FILE instead of stdout
  --no-text             skip paste text output
  --no-attachment       skip attachment auto-save
  --force               overwrite existing files
  --password PW         decrypt password-protected paste

DELETE FLAGS
  --token TOKEN         delete token (otherwise read from local history)

GLOBAL
  --version             print version
  --help, -h            this help

ENV
  DROPLN_SERVER        default server URL when --server is not given
  DROPLN_HISTORY       custom history file path (default: $XDG_CONFIG_HOME/dropln/history.json)
`

func main() {
	cfg, action, err := parseArgs(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		fmt.Fprintln(os.Stderr, "run `dropln --help` for usage.")
		os.Exit(2)
	}

	switch action {
	case actionHelp:
		fmt.Print(helpText)
	case actionVersion:
		fmt.Println("dropln", Version)
	case actionFetch:
		if err := fetchAndPrint(cfg); err != nil {
			fail(err)
		}
	case actionCreate:
		if err := createFlow(cfg); err != nil {
			fail(err)
		}
	case actionDelete:
		if err := runDelete(cfg); err != nil {
			fail(err)
		}
	case actionList:
		if err := runList(); err != nil {
			fail(err)
		}
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}

// ─── arg parsing ─────────────────────────────────────────────────────────

type runConfig struct {
	server       string
	ref          string // for fetch
	expire       string
	burn         bool
	password     string
	file         string
	format       paste.Formatter
	noDiscussion bool
	copy         bool
	quiet        bool
	note         string

	// fetch-side
	output       string
	extract      string
	noText       bool
	noAttachment bool
	force        bool

	// delete-side
	deleteID    string
	deleteToken string
}

type action int

const (
	actionCreate action = iota
	actionFetch
	actionDelete
	actionList
	actionHelp
	actionVersion
)

func parseArgs(args []string) (*runConfig, action, error) {
	fs := flag.NewFlagSet("dropln", flag.ContinueOnError)
	fs.SetOutput(io.Discard) // we render our own help

	cfg := &runConfig{}
	var (
		showVersion bool
		showHelpL   bool
		showHelpS   bool
		quietL      bool
		quietS      bool
		formatStr   string
	)
	fs.StringVar(&cfg.server, "server", "", "")
	fs.StringVar(&cfg.expire, "expire", "1day", "")
	fs.BoolVar(&cfg.burn, "burn", false, "")
	fs.StringVar(&cfg.password, "password", "", "")
	fs.StringVar(&cfg.file, "file", "", "")
	fs.StringVar(&formatStr, "format", "plaintext", "")
	fs.BoolVar(&cfg.noDiscussion, "no-discussion", false, "")
	fs.BoolVar(&cfg.copy, "copy", false, "")
	fs.BoolVar(&quietL, "quiet", false, "")
	fs.BoolVar(&quietS, "q", false, "")
	fs.StringVar(&cfg.note, "note", "", "")
	fs.StringVar(&cfg.output, "output", "", "")
	fs.StringVar(&cfg.extract, "extract", "", "")
	fs.BoolVar(&cfg.noText, "no-text", false, "")
	fs.BoolVar(&cfg.noAttachment, "no-attachment", false, "")
	fs.BoolVar(&cfg.force, "force", false, "")
	fs.StringVar(&cfg.deleteToken, "token", "", "")
	fs.BoolVar(&showVersion, "version", false, "")
	fs.BoolVar(&showHelpL, "help", false, "")
	fs.BoolVar(&showHelpS, "h", false, "")

	if err := fs.Parse(args); err != nil {
		return nil, 0, err
	}

	cfg.quiet = quietL || quietS
	cfg.format = paste.Formatter(formatStr)
	if cfg.server == "" {
		cfg.server = os.Getenv("DROPLN_SERVER")
	}
	if cfg.server == "" {
		cfg.server = "http://localhost:8080"
	}
	cfg.server = strings.TrimRight(cfg.server, "/")

	if showHelpL || showHelpS {
		return cfg, actionHelp, nil
	}
	if showVersion {
		return cfg, actionVersion, nil
	}

	rest := fs.Args()
	if len(rest) >= 1 {
		switch rest[0] {
		case "list":
			if len(rest) > 1 {
				return nil, 0, fmt.Errorf("`list` takes no arguments")
			}
			return cfg, actionList, nil
		case "delete", "rm":
			if len(rest) < 2 {
				return nil, 0, fmt.Errorf("`%s` needs a paste id (e.g. `dropln %s abc123def456789a`)", rest[0], rest[0])
			}
			cfg.deleteID = rest[1]
			if len(rest) >= 3 && cfg.deleteToken == "" {
				cfg.deleteToken = rest[2]
			}
			if len(rest) > 3 {
				return nil, 0, fmt.Errorf("unexpected extra args after delete: %v", rest[3:])
			}
			return cfg, actionDelete, nil
		}
	}
	if len(rest) > 1 {
		return nil, 0, fmt.Errorf("unexpected extra args: %v", rest[1:])
	}
	if len(rest) == 1 && isPasteRef(rest[0]) {
		cfg.ref = rest[0]
		return cfg, actionFetch, nil
	}
	if len(rest) == 1 {
		return nil, 0, fmt.Errorf("unrecognized argument %q (expected paste ref or none)", rest[0])
	}
	return cfg, actionCreate, nil
}

// ─── ref parsing ─────────────────────────────────────────────────────────

var (
	idRefRe   = regexp.MustCompile(`^([0-9a-f]{16})#(.+)$`)
	httpRefRe = regexp.MustCompile(`^https?://`)
	pathRe    = regexp.MustCompile(`^/p/([0-9a-f]{16})/?$`)
)

// keyFragmentLen is the length of a base64-URL-encoded 32-byte key with
// no padding (32 * 8 / 6 = 42.67 → 43 chars). A "warn before reading"
// URL prepends "-" → 44 chars. Length disambiguates: base64url's
// alphabet includes "-", so a string-prefix check would mis-classify
// keys that happen to start with "-".
const keyFragmentLen = 43

func isPasteRef(s string) bool {
	if idRefRe.MatchString(s) {
		_, _, err := parseFragment(idRefRe.FindStringSubmatch(s)[2])
		return err == nil
	}
	if httpRefRe.MatchString(s) {
		u, err := url.Parse(s)
		if err != nil {
			return false
		}
		if !pathRe.MatchString(u.Path) || u.Fragment == "" {
			return false
		}
		_, _, err = parseFragment(u.Fragment)
		return err == nil
	}
	return false
}

func parseRef(serverDefault, ref string) (server, id, key string, burn bool, err error) {
	if m := idRefRe.FindStringSubmatch(ref); m != nil {
		burn, key, err = parseFragment(m[2])
		if err != nil {
			return "", "", "", false, err
		}
		return serverDefault, m[1], key, burn, nil
	}
	if httpRefRe.MatchString(ref) {
		u, err := url.Parse(ref)
		if err != nil {
			return "", "", "", false, err
		}
		m := pathRe.FindStringSubmatch(u.Path)
		if m == nil {
			return "", "", "", false, errors.New("not a paste URL path")
		}
		burn, key, err := parseFragment(u.Fragment)
		if err != nil {
			return "", "", "", false, err
		}
		return u.Scheme + "://" + u.Host, m[1], key, burn, nil
	}
	return "", "", "", false, errors.New("unrecognized paste reference")
}

func parseFragment(frag string) (burn bool, key string, err error) {
	switch len(frag) {
	case keyFragmentLen:
		return false, frag, nil
	case keyFragmentLen + 1:
		if frag[0] != '-' {
			return false, "", fmt.Errorf("invalid key fragment (length %d but no leading '-')", len(frag))
		}
		return true, frag[1:], nil
	default:
		return false, "", fmt.Errorf("invalid key length: %d (expected %d or %d with leading '-')", len(frag), keyFragmentLen, keyFragmentLen+1)
	}
}

// ─── HTTP ────────────────────────────────────────────────────────────────

var httpClient = &http.Client{Timeout: 60 * time.Second}

type createResponse struct {
	ID          string `json:"id"`
	DeleteToken string `json:"delete_token"`
}

func httpCreate(server string, envelope paste.Payload) (createResponse, error) {
	body, err := json.Marshal(envelope)
	if err != nil {
		return createResponse{}, err
	}
	resp, err := httpClient.Post(server+"/api/v1/paste", "application/json", bytes.NewReader(body))
	if err != nil {
		return createResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		return createResponse{}, fmt.Errorf("%s: %s", resp.Status, strings.TrimSpace(string(b)))
	}
	var out createResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return createResponse{}, err
	}
	return out, nil
}

func httpRead(server, id string) (paste.Payload, error) {
	resp, err := httpClient.Get(server + "/api/v1/paste/" + id)
	if err != nil {
		return paste.Payload{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return paste.Payload{}, errors.New("paste not found (expired, deleted, or burned)")
	}
	if resp.StatusCode != http.StatusOK {
		return paste.Payload{}, fmt.Errorf("%s", resp.Status)
	}
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return paste.Payload{}, err
	}
	p, err := paste.Decode(b)
	if err != nil {
		return paste.Payload{}, fmt.Errorf("malformed envelope from server: %w", err)
	}
	return *p, nil
}

// ─── create flow ─────────────────────────────────────────────────────────

func createFlow(cfg *runConfig) error {
	var pl clientcrypto.PlainPaste

	if !isTerminal(os.Stdin) {
		b, err := io.ReadAll(os.Stdin)
		if err != nil {
			return fmt.Errorf("read stdin: %w", err)
		}
		pl.Paste = string(b)
	}

	if cfg.file != "" {
		data, err := os.ReadFile(cfg.file)
		if err != nil {
			return fmt.Errorf("read attachment: %w", err)
		}
		mt := mime.TypeByExtension(filepath.Ext(cfg.file))
		if mt == "" {
			mt = "application/octet-stream"
		}
		pl.Attachment = "data:" + mt + ";base64," + base64.StdEncoding.EncodeToString(data)
		pl.AttachmentName = filepath.Base(cfg.file)
	}

	if pl.Paste == "" && pl.Attachment == "" {
		return errors.New("no input — pipe content via stdin or pass --file PATH")
	}

	formatter := cfg.format
	if formatter == "" {
		formatter = paste.FormatterPlaintext
	}

	res, err := clientcrypto.Encrypt(clientcrypto.EncryptOpts{
		Plaintext:      pl,
		Password:       cfg.password,
		Expire:         cfg.expire,
		Formatter:      formatter,
		BurnAfterRead:  cfg.burn,
		OpenDiscussion: !cfg.noDiscussion,
	})
	if err != nil {
		return fmt.Errorf("encrypt: %w", err)
	}

	created, err := httpCreate(cfg.server, res.Envelope)
	if err != nil {
		return fmt.Errorf("create paste: %w", err)
	}

	fragment := res.KeyB64Url
	if cfg.burn {
		fragment = "-" + fragment
	}
	pasteURL := cfg.server + "/p/" + created.ID + "#" + fragment

	// Record to local history (best-effort — never fails the user-facing
	// flow, since the paste is already uploaded).
	now := time.Now()
	var expiresAt *time.Time
	if d := expiryDuration(cfg.expire); d > 0 {
		t := now.Add(d)
		expiresAt = &t
	}
	if err := recordPaste(historyEntry{
		ID:          created.ID,
		Key:         res.KeyB64Url,
		DeleteToken: created.DeleteToken,
		URL:         pasteURL,
		Server:      cfg.server,
		ExpiresAt:   expiresAt,
		CreatedAt:   now,
		Burn:        cfg.burn,
		Note:        cfg.note,
	}); err != nil {
		fmt.Fprintln(os.Stderr, "warn: could not write history:", err)
	}

	if cfg.copy {
		if err := clipboardCopy(pasteURL); err != nil {
			fmt.Fprintln(os.Stderr, "warn: clipboard copy failed:", err)
		}
	}

	if cfg.quiet {
		fmt.Println(pasteURL)
		return nil
	}
	fmt.Fprintln(os.Stderr, "✓ encrypted and uploaded")
	fmt.Println(pasteURL)
	fmt.Fprintln(os.Stderr, "  delete token:", created.DeleteToken)
	if cfg.burn {
		fmt.Fprintln(os.Stderr, "  ⚠ this URL will self-destruct on first read")
	}
	if cfg.password != "" {
		fmt.Fprintln(os.Stderr, "  ⚠ recipient also needs the password (separately)")
	}
	return nil
}

// expiryDuration mirrors the server's paste.ResolveExpire mapping
// (internal/paste/expire.go) so we can record an approximate expires_at
// in local history.
func expiryDuration(v string) time.Duration {
	return map[string]time.Duration{
		"5min":   5 * time.Minute,
		"10min":  10 * time.Minute,
		"1hour":  time.Hour,
		"1day":   24 * time.Hour,
		"1week":  7 * 24 * time.Hour,
		"1month": 30 * 24 * time.Hour,
		"1year":  365 * 24 * time.Hour,
	}[v]
}

// ─── fetch flow ──────────────────────────────────────────────────────────

func fetchAndPrint(cfg *runConfig) error {
	server, id, keyB64, _, err := parseRef(cfg.server, cfg.ref)
	if err != nil {
		return err
	}

	envelope, err := httpRead(server, id)
	if err != nil {
		return err
	}

	pl, err := clientcrypto.Decrypt(envelope, keyB64, cfg.password)
	if err != nil {
		return err
	}

	// 1. Paste text: --output writes to file; otherwise stdout (unless --no-text).
	if !cfg.noText {
		if cfg.output != "" {
			if err := writeOutFile(cfg.output, []byte(pl.Paste), cfg.force); err != nil {
				return err
			}
			fmt.Fprintln(os.Stderr, "saved paste text:", cfg.output)
		} else if pl.Paste != "" {
			fmt.Print(pl.Paste)
			if !strings.HasSuffix(pl.Paste, "\n") {
				fmt.Println()
			}
		}
	}

	// 2. Attachment: save unless --no-attachment.
	if !cfg.noAttachment && pl.Attachment != "" {
		i := strings.Index(pl.Attachment, "base64,")
		if i < 0 {
			fmt.Fprintln(os.Stderr, "warn: attachment uses unsupported encoding")
			return nil
		}
		data, err := base64.StdEncoding.DecodeString(pl.Attachment[i+7:])
		if err != nil {
			return fmt.Errorf("decode attachment: %w", err)
		}
		name := safeAttachmentName(pl.AttachmentName)
		if name == "" {
			name = "attachment.bin"
		}
		dir := cfg.extract
		if dir == "" {
			dir = "."
		}
		outPath := filepath.Join(dir, name)
		if err := writeOutFile(outPath, data, cfg.force); err != nil {
			return err
		}
		fmt.Fprintln(os.Stderr, "saved attachment:", outPath)
	}

	return nil
}

// writeOutFile writes data to path, refusing to overwrite unless force is
// set. Creates parent directories as needed.
func writeOutFile(path string, data []byte, force bool) error {
	if !force {
		if _, err := os.Stat(path); err == nil {
			return fmt.Errorf("%s already exists (use --force to overwrite)", path)
		}
	}
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("mkdir %s: %w", dir, err)
		}
	}
	return os.WriteFile(path, data, 0o644)
}

// safeAttachmentName strips path traversal characters so a malicious
// attachment_name can't write outside the destination directory.
func safeAttachmentName(s string) string {
	if s == "" {
		return ""
	}
	return filepath.Base(s)
}

// ─── delete flow ─────────────────────────────────────────────────────────

func runDelete(cfg *runConfig) error {
	if !regexp.MustCompile(`^[0-9a-f]{16}$`).MatchString(cfg.deleteID) {
		return fmt.Errorf("invalid paste id %q (expected 16 hex chars)", cfg.deleteID)
	}

	h, _ := loadHistory()
	var entry *historyEntry
	if h != nil {
		entry = h.find(cfg.deleteID)
	}

	server := cfg.server
	token := cfg.deleteToken

	// If user didn't pass --token, look it up locally.
	if token == "" {
		if entry == nil {
			return errors.New("no delete token: paste not in local history. " +
				"pass `--token <delete_token>` explicitly")
		}
		token = entry.DeleteToken
		// Default to the server we created on too — the user clearly
		// didn't override, and the paste only exists on its origin.
		if entry.Server != "" {
			server = entry.Server
		}
	}

	endpoint := fmt.Sprintf("%s/api/v1/paste/%s?token=%s",
		strings.TrimRight(server, "/"), cfg.deleteID, url.QueryEscape(token))
	req, err := http.NewRequest(http.MethodDelete, endpoint, nil)
	if err != nil {
		return err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusNoContent:
		// Drop from history if present.
		if h != nil && h.remove(cfg.deleteID) {
			_ = saveHistory(h)
		}
		fmt.Fprintln(os.Stderr, "✓ deleted")
		return nil
	case http.StatusNotFound:
		return errors.New("not found — already deleted, expired, burned, or wrong token")
	default:
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server: %s — %s", resp.Status, strings.TrimSpace(string(b)))
	}
}

// ─── helpers ─────────────────────────────────────────────────────────────

func isTerminal(f *os.File) bool {
	fi, err := f.Stat()
	if err != nil {
		return true
	}
	return fi.Mode()&os.ModeCharDevice != 0
}

func clipboardCopy(s string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("pbcopy")
	case "linux":
		if _, err := exec.LookPath("wl-copy"); err == nil {
			cmd = exec.Command("wl-copy")
		} else if _, err := exec.LookPath("xclip"); err == nil {
			cmd = exec.Command("xclip", "-selection", "clipboard")
		} else if _, err := exec.LookPath("xsel"); err == nil {
			cmd = exec.Command("xsel", "--clipboard", "--input")
		} else {
			return errors.New("no clipboard tool found (install wl-copy / xclip / xsel)")
		}
	case "windows":
		cmd = exec.Command("clip")
	default:
		return fmt.Errorf("clipboard not supported on %s", runtime.GOOS)
	}
	cmd.Stdin = strings.NewReader(s)
	return cmd.Run()
}
