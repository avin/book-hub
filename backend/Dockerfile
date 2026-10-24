FROM golang:1.26-alpine AS build

WORKDIR /src/backend

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/book-hub-server ./cmd/book-hub-server
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/book-hub-migrate ./cmd/book-hub-migrate
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/book-hub-admin ./cmd/book-hub-admin
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/book-hub-backup ./cmd/book-hub-backup

FROM alpine:3.22

RUN apk add --no-cache ca-certificates wget postgresql16-client postgresql17-client \
	&& addgroup -S bookhub \
	&& adduser -S -G bookhub bookhub \
	&& mkdir -p /app/migrations /data/books /data/db \
	&& chown -R bookhub:bookhub /app /data

WORKDIR /app

COPY --from=build /out/book-hub-server /usr/local/bin/book-hub-server
COPY --from=build /out/book-hub-migrate /usr/local/bin/book-hub-migrate
COPY --from=build /out/book-hub-admin /usr/local/bin/book-hub-admin
COPY --from=build /out/book-hub-backup /usr/local/bin/book-hub-backup
COPY --from=build /src/backend/migrations ./migrations

USER bookhub

EXPOSE 8080

ENTRYPOINT ["book-hub-server"]
