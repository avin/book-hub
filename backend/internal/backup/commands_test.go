package backup

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestMakeBackupRestoreStopStartSequence(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Make operational shell harness runs on Linux")
	}
	if _, err := exec.LookPath("make"); err != nil {
		t.Skip("make unavailable")
	}
	makefile, err := os.ReadFile(filepath.Join("..", "..", "..", "Makefile"))
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ name, target, fail, want string }{
		{"backup success", "backup", "", "stop\ncreate\nstart\n"},
		{"backup failure", "backup", "create", "stop\ncreate\n"},
		{"restore success", "restore", "", "validate\nstop\nrestore\nstart\n"},
		{"restore failure", "restore", "restore", "validate\nstop\nrestore\n"},
		{"validation failure", "restore", "validate", "validate\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			os.WriteFile(filepath.Join(root, "Makefile"), makefile, 0600)
			archive := filepath.Join(root, "copy")
			os.Mkdir(archive, 0700)
			mock := filepath.Join(root, "compose")
			log := filepath.Join(root, "operations")
			script := `#!/bin/sh
case "$*" in
 *"backup validate"*) stage=validate ;;
 *"book-hub-backup create"*) stage=create ;;
 *"book-hub-backup restore"*) stage=restore ;;
 "stop backend frontend") stage=stop ;;
 "up -d --wait backend frontend") stage=start ;;
 *) echo "unexpected compose arguments: $*" >&2; exit 9 ;;
esac
printf '%s\n' "$stage" >> "$OPERATION_LOG"
[ "$stage" != "$FAIL_STAGE" ]
`
			os.WriteFile(mock, []byte(script), 0700)
			command := exec.Command("make", "--no-print-directory", test.target, "BOOK_HUB_DATABASE_URL=sqlite:///unused.sqlite", "COMPOSE_OPERATIONS="+mock, "BACKUP_DIR="+filepath.Join(root, "backups"), "BACKUP="+archive)
			command.Dir = root
			command.Env = append(os.Environ(), "OPERATION_LOG="+log, "FAIL_STAGE="+test.fail)
			output, err := command.CombinedOutput()
			if (err != nil) != (test.fail != "") {
				t.Fatalf("command err=%v output=%s", err, output)
			}
			actual, err := os.ReadFile(log)
			if err != nil || strings.ReplaceAll(string(actual), "\r\n", "\n") != test.want {
				t.Fatalf("operations %q want %q err=%v output=%s", actual, test.want, err, output)
			}
		})
	}
}
