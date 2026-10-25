#!/bin/sh
set -eu
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
prefix=${BOOK_HUB_TEST_PREFIX:-book-hub-storage-test}
image=${BOOK_HUB_TEST_IMAGE:-book-hub-storage-tests:local}
case "$prefix" in ''|*[!a-z0-9-]*) echo 'Invalid test service prefix' >&2; exit 1;; esac
exists() { docker inspect "$1" >/dev/null 2>&1; }
docker network inspect "$prefix" >/dev/null 2>&1 || docker network create "$prefix"
if [ "${BOOK_HUB_TEST_SKIP_BUILD:-0}" != 1 ]; then docker build -t "$image" "$directory"; fi
postgres=$prefix-postgres
runner=$prefix-runner
ftp=$prefix-ftp
s3=$prefix-s3
if ! exists "$postgres"; then
  docker create --name "$postgres" --label book-hub.storage-test=true --network "$prefix" --network-alias postgres --tmpfs /var/lib/postgresql/data:rw,size=384m -e POSTGRES_PASSWORD=storage-test-password -e POSTGRES_DB=book_hub_test postgres:17-alpine
fi
docker start "$postgres"
if ! exists "$runner"; then
  docker create --name "$runner" --label book-hub.storage-test=true --network "$prefix" --tmpfs /tmp:rw,exec,size=768m --tmpfs /root/.cache/go-build:rw,exec,size=768m -v "$prefix-modules:/go/pkg/mod" \
    -e BOOK_HUB_TEST_DATABASE_URL=postgres://postgres:storage-test-password@postgres:5432/book_hub_test?sslmode=disable \
    -e BOOK_HUB_TEST_FTP_ADDR=storage-fixtures:2121 -e BOOK_HUB_TEST_FTPS_EXPLICIT_ADDR=storage-fixtures:2122 -e BOOK_HUB_TEST_FTPS_IMPLICIT_ADDR=storage-fixtures:2990 \
    -e BOOK_HUB_TEST_FTPS_CA_FILE=/fixtures/server.pem -e BOOK_HUB_TEST_S3_ENDPOINT=http://storage-s3:3900 "$image" tail -f /dev/null
fi
docker start "$runner"
docker exec "$runner" mkdir -p /fixtures
for file in ftp_fixture.py garage.toml smoke.py; do docker cp "$directory/$file" "$runner:/fixtures/$file"; done
docker exec "$runner" sh -c 'test -f /fixtures/server.pem || openssl req -x509 -newkey rsa:2048 -nodes -keyout /fixtures/server.key -out /fixtures/server.pem -days 30 -subj /CN=storage-fixtures -addext subjectAltName=DNS:storage-fixtures,DNS:localhost,IP:127.0.0.1'
mkdir -p "$directory/.runtime"
for file in server.pem server.key; do docker cp "$runner:/fixtures/$file" "$directory/.runtime/$file"; done
if ! exists "$ftp"; then
  docker create --name "$ftp" --label book-hub.storage-test=true --network "$prefix" --network-alias storage-fixtures "$image" python /fixtures/ftp_fixture.py
  docker cp "$directory/." "$ftp:/fixtures"
  for file in server.pem server.key; do docker cp "$directory/.runtime/$file" "$ftp:/fixtures/$file"; done
fi
docker start "$ftp"
if ! exists "$s3"; then
  docker create --name "$s3" --label book-hub.storage-test=true --network "$prefix" --network-alias storage-s3 \
    -e GARAGE_DEFAULT_ACCESS_KEY=GK00000000000000000000000000000001 -e GARAGE_DEFAULT_SECRET_KEY=codex-bookhub-s3-test-secret-000000000000000000000000000000000000 \
    -e GARAGE_DEFAULT_BUCKET=bookhub-test dxflrs/garage:v2.5.0 /garage server --single-node --default-bucket
  docker cp "$directory/garage.toml" "$s3:/etc/garage.toml"
fi
docker start "$s3"
attempt=0
until docker exec "$runner" python /fixtures/smoke.py; do
  attempt=$((attempt+1)); [ "$attempt" -lt 30 ] || exit 1; sleep 1
done
printf 'Services ready. Runner: %s\n' "$runner"
