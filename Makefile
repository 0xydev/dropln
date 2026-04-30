.PHONY: build build-go build-web build-cli run dev test test-integration tidy fmt vet lint clean db-up db-down

BINARY     := bin/dropln
CLI_BINARY := bin/dropln-cli
PKG        := ./...
TEST_DB    := postgres://dropln:dropln@localhost:5432/dropln?sslmode=disable
VERSION    := $(shell git describe --tags --always 2>/dev/null || echo dev)

# Build everything: frontend bundle first (so the Go embed has fresh assets),
# then the server binary, then the CLI client.
build: build-web build-go build-cli

build-web:
	cd web && npm install --silent && npm run build

build-go:
	@mkdir -p bin
	go build -trimpath -ldflags="-s -w" -o $(BINARY) ./cmd/dropln

build-cli:
	@mkdir -p bin
	go build -trimpath -ldflags="-s -w -X main.Version=$(VERSION)" -o $(CLI_BINARY) ./cmd/dropln-cli

run: build
	DROPLN_DATABASE_URL='$(TEST_DB)' ./$(BINARY)

# Frontend dev server (Vite at :5173) with HMR. Requires the Go backend to
# be running on :8080 — Vite proxies /api/* to it.
dev:
	cd web && npm run dev

test:
	go test -race -count=1 $(PKG)

# Requires `make db-up` first.
test-integration:
	DROPLN_TEST_DATABASE_URL='$(TEST_DB)' go test -race -count=1 $(PKG)

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
	docker run -d --name dropln-pg \
		-e POSTGRES_PASSWORD=dropln \
		-e POSTGRES_USER=dropln \
		-e POSTGRES_DB=dropln \
		-p 5432:5432 \
		postgres:17-alpine

db-down:
	-docker stop dropln-pg
	-docker rm dropln-pg
