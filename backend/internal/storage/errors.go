package storage

import "errors"

// ErrUnavailable signals a temporary storage failure, such as an exhausted lock wait.
var ErrUnavailable = errors.New("storage temporarily unavailable")
