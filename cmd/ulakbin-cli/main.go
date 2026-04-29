// ulakbin — CLI client for the ulakbin paste server.
//
// Common flows:
//
//   echo "hello" | ulakbin                    # stdin → URL
//   cat error.log | ulakbin --burn            # one-time-read URL
//   ulakbin --file diagram.png                # attachment → URL
//   ulakbin abc123def456789a#KEY              # fetch & decrypt → stdout
//   ulakbin https://ulakb.example.com/p/abc/#KEY
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

	"github.com/0xydev/ulakbin/internal/clientcrypto"
	"github.com/0xydev/ulakbin/internal/paste"
)

// Version is overridable at build time:
//
//	go build -ldflags "-X main.Version=$(git describe --tags --always)"
var Version = "dev"

const helpText = `ulakbin — encrypted ephemeral paste

USAGE
  ulakbin                              read paste content from stdin → URL
  ulakbin <ref>                        fetch & decrypt (ref = id#key or full URL)
  ulakbin --file PATH                  attach file as encrypted paste → URL

FLAGS
  --server URL          server endpoint (env ULAKBIN_SERVER, default http://localhost:8080)
  --expire WIN          5min|10min|1hour|1day|1week|1month|1year|never (default 1day)
  --burn                one-time-read paste (URL gets #- warning prefix)
  --password PW         password protect (combined with URL key via PBKDF2)
  --file PATH           attach file (in addition to or instead of stdin)
  --format FMT          plaintext | syntaxhighlighting | markdown (default plaintext)
  --no-discussion       disable comments on this paste
  --copy                also copy resulting URL to clipboard (pbcopy/xclip/wl-copy)
  --quiet, -q           print only the URL
  --output PATH         when fetching, write decrypted content to PATH instead of stdout
  --version             print version
  --help, -h            this help

ENV
  ULAKBIN_SERVER        default server URL when --server is not given
`

func main() {
	cfg, action, err := parseArgs(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		fmt.Fprintln(os.Stderr, "run `ulakbin --help` for usage.")
		os.Exit(2)
	}

	switch action {
	case actionHelp:
		fmt.Print(helpText)
	case actionVersion:
		fmt.Println("ulakbin", Version)
	case actionFetch:
		if err := fetchAndPrint(cfg); err != nil {
			fail(err)
		}
	case actionCreate:
		if err := createFlow(cfg); err != nil {
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
	output       string
}

type action int

const (
	actionCreate action = iota
	actionFetch
	actionHelp
	actionVersion
)

func parseArgs(args []string) (*runConfig, action, error) {
	fs := flag.NewFlagSet("ulakbin", flag.ContinueOnError)
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
	fs.StringVar(&cfg.output, "output", "", "")
	fs.BoolVar(&showVersion, "version", false, "")
	fs.BoolVar(&showHelpL, "help", false, "")
	fs.BoolVar(&showHelpS, "h", false, "")

	if err := fs.Parse(args); err != nil {
		return nil, 0, err
	}

	cfg.quiet = quietL || quietS
	cfg.format = paste.Formatter(formatStr)
	if cfg.server == "" {
		cfg.server = os.Getenv("ULAKBIN_SERVER")
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

	if cfg.output != "" {
		// Prefer attachment when present (likely binary); fall back to paste text.
		var data []byte
		if pl.Attachment != "" {
			if i := strings.Index(pl.Attachment, "base64,"); i > 0 {
				data, err = base64.StdEncoding.DecodeString(pl.Attachment[i+7:])
				if err != nil {
					return fmt.Errorf("decode attachment: %w", err)
				}
			}
		}
		if data == nil {
			data = []byte(pl.Paste)
		}
		return os.WriteFile(cfg.output, data, 0o644)
	}

	if pl.Paste != "" {
		fmt.Print(pl.Paste)
		if !strings.HasSuffix(pl.Paste, "\n") {
			fmt.Println()
		}
	}

	if pl.Attachment != "" && pl.AttachmentName != "" {
		if i := strings.Index(pl.Attachment, "base64,"); i > 0 {
			data, err := base64.StdEncoding.DecodeString(pl.Attachment[i+7:])
			if err == nil {
				name := safeAttachmentName(pl.AttachmentName)
				if err := os.WriteFile(name, data, 0o644); err == nil {
					fmt.Fprintln(os.Stderr, "saved attachment:", name)
				} else {
					fmt.Fprintln(os.Stderr, "warn: could not save attachment:", err)
				}
			}
		}
	}
	return nil
}

// safeAttachmentName strips path traversal characters so a malicious
// attachment_name can't write outside the working directory.
func safeAttachmentName(s string) string {
	return filepath.Base(s)
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
