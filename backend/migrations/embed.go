package migrations

import "embed"

// Files includes the immutable PostgreSQL history and the SQLite schema.
//
//go:embed *.sql sqlite/*.sql
var Files embed.FS
