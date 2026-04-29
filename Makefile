.PHONY: build build-go build-web run dev test test-integration tidy fmt vet lint clean db-up db-down

BINARY  := bin/ulakbin
PKG     := ./...
TEST_DB := postgres://ulakbin:ulakbin@localhost:5432/ulakbin?sslmode=disable

# Build everything: frontend bundle first (so the Go embed has fresh assets),
# then the Go binary.
build: build-web build-go

build-web:
	cd web && npm install --silent && npm run build

build-go:
	@mkdir -p bin
	go build -trimpath -ldflags="-s -w" -o $(BINARY) ./cmd/ulakbin

run: build
	ULAKBIN_DATABASE_URL='$(TEST_DB)' ./$(BINARY)

# Frontend dev server (Vite at :5173) with HMR. Requires the Go backend to
# be running on :8080 — Vite proxies /api/* to it.
dev:
	cd web && npm run dev

test:
	go test -race -count=1 $(PKG)

# Requires `make db-up` first.
test-integration:
	ULAKBIN_TEST_DATABASE_URL='$(TEST_DB)' go test -race -count=1 $(PKG)

tidy:
	go mod tidy

fmt:
	gofmt -s -w .

vet:
	go vet $(PKG)

lint: fmt vet
	@echo "lint passed"

clean:
	rm -rf bin/ web/dist/

db-up:
	docker run -d --name ulakbin-pg \
		-e POSTGRES_PASSWORD=ulakbin \
		-e POSTGRES_USER=ulakbin \
		-e POSTGRES_DB=ulakbin \
		-p 5432:5432 \
		postgres:17-alpine

db-down:
	-docker stop ulakbin-pg
	-docker rm ulakbin-pg
