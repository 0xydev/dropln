package postgres_test

import (
	"context"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/0xydev/dropln/internal/paste"
	"github.com/0xydev/dropln/internal/storage"
	"github.com/0xydev/dropln/internal/storage/postgres"
)

// A real Format v2 envelope; exact bytes don't matter at the storage layer
// (server treats Payload as opaque), but we use a valid one for realism.
const samplePayload = `{"v":2,"ct":"ME5JF/YBEijp2uYMzLZozbKtWc5wfy6R59NBb7SmRig=","adata":[["gMSNoLOk4z0RnmsYwXZ8mw==","TZO+JWuIuxs=",100000,256,128,"aes","gcm","zlib"],"plaintext",1,0],"meta":{"expire":"5min"}}`

func newStore(t *testing.T) *postgres.Store {
	t.Helper()
	dsn := os.Getenv("DROPLN_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set DROPLN_TEST_DATABASE_URL to run postgres integration tests (e.g. postgres://dropln:dropln@localhost:5432/dropln?sslmode=disable)")
	}
	ctx := context.Background()
	s, err := postgres.New(ctx, dsn)
	if err != nil {
		t.Fatalf("postgres.New: %v", err)
	}
	t.Cleanup(s.Close)
	return s
}

func mustID(t *testing.T) string {
	t.Helper()
	id, err := paste.NewID()
	if err != nil {
		t.Fatalf("NewID: %v", err)
	}
	return id
}

func mustToken(t *testing.T) string {
	t.Helper()
	tok, err := paste.NewDeleteToken()
	if err != nil {
		t.Fatalf("NewDeleteToken: %v", err)
	}
	return tok
}

func makePaste(t *testing.T) storage.Paste {
	t.Helper()
	return storage.Paste{
		ID:          mustID(t),
		Payload:     []byte(samplePayload),
		DeleteToken: mustToken(t),
	}
}

func TestCreateAndRead(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	p := makePaste(t)
	if err := s.Create(ctx, p); err != nil {
		t.Fatalf("Create: %v", err)
	}
	t.Cleanup(func() { _, _ = s.Delete(ctx, p.ID, p.DeleteToken) })

	got, found, err := s.Read(ctx, p.ID)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if !found {
		t.Fatal("paste not found after create")
	}
	if string(got.Payload) != samplePayload {
		t.Errorf("payload mismatch:\n got=%s\nwant=%s", got.Payload, samplePayload)
	}
	if got.BurnAfterRead {
		t.Error("BurnAfterRead: want false")
	}
	if got.ExpiresAt != nil {
		t.Errorf("ExpiresAt: want nil, got %v", got.ExpiresAt)
	}
}

func TestRead_Missing(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	_, found, err := s.Read(ctx, mustID(t))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if found {
		t.Error("found a paste that was never created")
	}
}

func TestBurnAfterRead(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	p := makePaste(t)
	p.BurnAfterRead = true
	if err := s.Create(ctx, p); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, found, err := s.Read(ctx, p.ID)
	if err != nil || !found {
		t.Fatalf("first read: found=%v err=%v", found, err)
	}
	if !got.BurnAfterRead {
		t.Error("first read: BurnAfterRead flag lost")
	}

	_, found, err = s.Read(ctx, p.ID)
	if err != nil {
		t.Fatalf("second read: %v", err)
	}
	if found {
		t.Error("second read: paste should be burned")
	}
}

// TestBurnAfterRead_Concurrent asserts that with N concurrent readers, exactly
// one observes the data and the other N-1 see "not found". This is the
// security property PrivateBin's PHP implementation does NOT guarantee.
func TestBurnAfterRead_Concurrent(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	p := makePaste(t)
	p.BurnAfterRead = true
	if err := s.Create(ctx, p); err != nil {
		t.Fatalf("Create: %v", err)
	}

	const readers = 32
	var wg sync.WaitGroup
	var hits int64
	start := make(chan struct{})

	for range readers {
		wg.Go(func() {
			<-start
			_, found, err := s.Read(ctx, p.ID)
			if err != nil {
				t.Errorf("concurrent read: %v", err)
				return
			}
			if found {
				atomic.AddInt64(&hits, 1)
			}
		})
	}
	close(start)
	wg.Wait()

	if hits != 1 {
		t.Errorf("expected exactly 1 reader to observe the paste, got %d", hits)
	}
}

func TestRead_Expired(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	past := time.Now().Add(-time.Minute)
	p := makePaste(t)
	p.ExpiresAt = &past
	if err := s.Create(ctx, p); err != nil {
		t.Fatalf("Create: %v", err)
	}
	t.Cleanup(func() { _, _ = s.Delete(ctx, p.ID, p.DeleteToken) })

	_, found, err := s.Read(ctx, p.ID)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if found {
		t.Error("expired paste should not be returned")
	}
}

func TestDelete_TokenMatch(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	p := makePaste(t)
	if err := s.Create(ctx, p); err != nil {
		t.Fatalf("Create: %v", err)
	}

	deleted, err := s.Delete(ctx, p.ID, p.DeleteToken)
	if err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if !deleted {
		t.Error("Delete: want true with correct token")
	}
	_, found, _ := s.Read(ctx, p.ID)
	if found {
		t.Error("paste still readable after Delete")
	}
}

func TestDelete_TokenMismatch(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	p := makePaste(t)
	if err := s.Create(ctx, p); err != nil {
		t.Fatalf("Create: %v", err)
	}
	t.Cleanup(func() { _, _ = s.Delete(ctx, p.ID, p.DeleteToken) })

	deleted, err := s.Delete(ctx, p.ID, "wrong-token")
	if err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if deleted {
		t.Error("Delete: should refuse wrong token")
	}
	_, found, _ := s.Read(ctx, p.ID)
	if !found {
		t.Error("paste should still exist after failed delete")
	}
}

func TestCreate_IDConflict(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	p := makePaste(t)
	if err := s.Create(ctx, p); err != nil {
		t.Fatalf("first Create: %v", err)
	}
	t.Cleanup(func() { _, _ = s.Delete(ctx, p.ID, p.DeleteToken) })

	err := s.Create(ctx, p)
	if err == nil {
		t.Fatal("expected ErrIDConflict, got nil")
	}
	if !errors.Is(err, storage.ErrIDConflict) {
		t.Errorf("expected ErrIDConflict, got %v", err)
	}
}

// commentPayload is just opaque bytes from storage's perspective.
const commentPayload = `{"v":2,"ct":"abcd","adata":[],"pasteid":"x","parentid":"x"}`

func makeComment(t *testing.T, pasteID string) storage.Comment {
	t.Helper()
	return storage.Comment{
		PasteID:  pasteID,
		ID:       mustID(t),
		ParentID: pasteID,
		Payload:  []byte(commentPayload),
	}
}

func TestCreateAndListComments(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	p := makePaste(t)
	if err := s.Create(ctx, p); err != nil {
		t.Fatalf("Create paste: %v", err)
	}
	t.Cleanup(func() { _, _ = s.Delete(ctx, p.ID, p.DeleteToken) })

	c1 := makeComment(t, p.ID)
	c2 := makeComment(t, p.ID)
	if err := s.CreateComment(ctx, c1); err != nil {
		t.Fatalf("CreateComment 1: %v", err)
	}
	// Force a >0 created_at gap so ordering is deterministic.
	time.Sleep(2 * time.Millisecond)
	if err := s.CreateComment(ctx, c2); err != nil {
		t.Fatalf("CreateComment 2: %v", err)
	}

	got, err := s.ListComments(ctx, p.ID)
	if err != nil {
		t.Fatalf("ListComments: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d comments, want 2", len(got))
	}
	if got[0].ID != c1.ID || got[1].ID != c2.ID {
		t.Errorf("comment order: got [%s, %s], want [%s, %s]",
			got[0].ID, got[1].ID, c1.ID, c2.ID)
	}
	if string(got[0].Payload) != commentPayload {
		t.Errorf("comment payload mismatch")
	}
}

func TestCreateComment_ParentMissing(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	c := makeComment(t, mustID(t)) // paste id never created
	err := s.CreateComment(ctx, c)
	if !errors.Is(err, storage.ErrParentMissing) {
		t.Errorf("got %v, want ErrParentMissing", err)
	}
}

func TestCreateComment_IDConflict(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	p := makePaste(t)
	if err := s.Create(ctx, p); err != nil {
		t.Fatalf("Create paste: %v", err)
	}
	t.Cleanup(func() { _, _ = s.Delete(ctx, p.ID, p.DeleteToken) })

	c := makeComment(t, p.ID)
	if err := s.CreateComment(ctx, c); err != nil {
		t.Fatalf("first CreateComment: %v", err)
	}
	err := s.CreateComment(ctx, c)
	if !errors.Is(err, storage.ErrIDConflict) {
		t.Errorf("got %v, want ErrIDConflict", err)
	}
}

func TestComments_CascadeOnPasteDelete(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	p := makePaste(t)
	if err := s.Create(ctx, p); err != nil {
		t.Fatalf("Create paste: %v", err)
	}
	c := makeComment(t, p.ID)
	if err := s.CreateComment(ctx, c); err != nil {
		t.Fatalf("CreateComment: %v", err)
	}

	if _, err := s.Delete(ctx, p.ID, p.DeleteToken); err != nil {
		t.Fatalf("Delete paste: %v", err)
	}
	got, err := s.ListComments(ctx, p.ID)
	if err != nil {
		t.Fatalf("ListComments: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %d comments after parent delete, want 0", len(got))
	}
}

func TestComments_CascadeOnBurn(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	p := makePaste(t)
	p.BurnAfterRead = true
	if err := s.Create(ctx, p); err != nil {
		t.Fatalf("Create paste: %v", err)
	}
	c := makeComment(t, p.ID)
	if err := s.CreateComment(ctx, c); err != nil {
		t.Fatalf("CreateComment: %v", err)
	}

	// Reading a burn-after-read paste deletes it; comments must vanish too.
	if _, _, err := s.Read(ctx, p.ID); err != nil {
		t.Fatalf("Read: %v", err)
	}
	got, err := s.ListComments(ctx, p.ID)
	if err != nil {
		t.Fatalf("ListComments: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %d comments after burn, want 0", len(got))
	}
}

func TestPurge(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)

	expired := makePaste(t)
	expired.ExpiresAt = &past
	if err := s.Create(ctx, expired); err != nil {
		t.Fatalf("Create expired: %v", err)
	}

	live := makePaste(t)
	live.ExpiresAt = &future
	if err := s.Create(ctx, live); err != nil {
		t.Fatalf("Create live: %v", err)
	}
	t.Cleanup(func() { _, _ = s.Delete(ctx, live.ID, live.DeleteToken) })

	never := makePaste(t)
	if err := s.Create(ctx, never); err != nil {
		t.Fatalf("Create never: %v", err)
	}
	t.Cleanup(func() { _, _ = s.Delete(ctx, never.ID, never.DeleteToken) })

	n, err := s.Purge(ctx, 100)
	if err != nil {
		t.Fatalf("Purge: %v", err)
	}
	if n < 1 {
		t.Errorf("Purge: expected at least 1 row purged, got %d", n)
	}

	if _, found, _ := s.Read(ctx, expired.ID); found {
		t.Error("expired paste should be gone after purge")
	}
	if _, found, _ := s.Read(ctx, live.ID); !found {
		t.Error("live paste should survive purge")
	}
	if _, found, _ := s.Read(ctx, never.ID); !found {
		t.Error("never-expiring paste should survive purge")
	}
}
