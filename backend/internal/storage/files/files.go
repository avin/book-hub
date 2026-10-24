// Package files separates original books from local application images and temporary files.
package files

import "path/filepath"

// Store assembles the storage used by the server and administrative tools.
// New preserves the on-disk layout of existing local installations and backups.
type Store struct {
	Books  Directory
	Images Images
	Work   Workspace
	root   string
}

func New(root string) Store {
	work := Workspace{root: filepath.Join(root, "tmp")}
	return Store{
		Books:  Directory{root: filepath.Join(root, "books")},
		Images: Images{root: filepath.Join(root, "covers"), work: work},
		Work:   work,
		root:   root,
	}
}

func (s Store) Root() string { return s.root }

func (s Store) Ensure() error {
	if err := s.Work.Ensure(); err != nil {
		return err
	}
	if err := s.Books.Ensure(); err != nil {
		return err
	}
	return s.Images.Ensure()
}

func (s Store) CheckReady() error {
	if err := s.Ensure(); err != nil {
		return err
	}
	return s.Work.CheckReady()
}
