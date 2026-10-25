#!/bin/sh
set -eu
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo=$(CDPATH= cd -- "${1:-$directory/../../..}" && pwd)
if [ "$#" -gt 0 ]; then shift; fi
runner=${BOOK_HUB_TEST_PREFIX:-book-hub-storage-test}-runner
[ -f "$repo/backend/go.mod" ] || { echo 'Expected Book Hub repository' >&2; exit 1; }
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT HUP INT TERM
slug=$(basename "$repo" | tr -cd 'a-zA-Z0-9_-')
remote=/worktrees/$slug-$(date +%s)-$$
(cd "$repo"; rg --files backend; printf 'Makefile\n') > "$scratch/files"
tar -C "$repo" -cf "$scratch/source.tar" -T "$scratch/files"
docker exec "$runner" mkdir -p "$remote"
docker cp "$scratch/source.tar" "$runner:$remote/source.tar"
docker exec "$runner" tar -xf "$remote/source.tar" -C "$remote"
if [ "$#" -eq 0 ]; then set -- test -p 2 -race ./...; fi
printf 'Linux source snapshot: %s/backend\n' "$remote"
docker exec "$runner" go -C "$remote/backend" "$@"
docker exec "$runner" rm -rf -- "$remote"
