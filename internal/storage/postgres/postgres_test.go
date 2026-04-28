package postgres_test

import (
	"context"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/0xydev/ulakbin/internal/paste"
	"github.com/0xydev/ulakbin/internal/storage"
	"github.com/0xydev/ulakbin/internal/storage/postgres"
)

// A real Format v2 envelope; exact bytes don't matter at the storage layer
// (server treats Payload as opaque), but we use a valid one for realism.
const samplePayload = `{"v":2,"ct":"ME5JF/YBEijp2uYMzLZozbKtWc5wfy6R59NBb7SmRig=","adata":[["gMSNoLOk4z0RnmsYwXZ8mw==","TZO+JWuIuxs=",100000,256,128,"aes","gcm","zlib"],"plaintext",1,0],"meta":{"expire":"5min"}}`

func newStore(t *testing.T) *postgres.Store {
	t.Helper()
	dsn := os.Getenv("ULAKBIN_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set ULAKBIN_TEST_DATABASE_URL to run postgres integration tests (e.g. postgres://ulakbin:ulakbin@localhost:5432/ulakbin?sslmode=disable)")
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
