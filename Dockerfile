# syntax=docker/dockerfile:1.7

# Stage 1: build the frontend bundle.
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci --silent
COPY web/ ./
RUN npm run build

# Stage 2: compile the Go binary with the frontend embedded.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ulakbin ./cmd/ulakbin

# Stage 3: minimal runtime.
FROM scratch
COPY --from=build /out/ulakbin /ulakbin
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/ulakbin"]
