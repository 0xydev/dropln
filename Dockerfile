# syntax=docker/dockerfile:1.7

FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ulakbin ./cmd/ulakbin

FROM scratch
COPY --from=build /out/ulakbin /ulakbin
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/ulakbin"]
