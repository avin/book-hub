package files

import (
	"book-hub/internal/config"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/textproto"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"book-hub/internal/domain"
	"github.com/google/uuid"
	"github.com/jlaffaye/ftp"
)

const ftpIdleTimeout = 30 * time.Second

type ftpOriginals struct {
	address, user, password, root string
	mode                          string
	tlsConfig                     *tls.Config
}

func (s *ftpOriginals) BookPath(hash, format string) string {
	if !validOriginalName(hash, format) {
		return ""
	}
	return path.Join(s.root, hash[:2], hash+"."+format)
}

func validOriginalName(hash, format string) bool {
	if len(hash) != 64 || hash != strings.ToLower(hash) {
		return false
	}
	if _, err := hex.DecodeString(hash); err != nil {
		return false
	}
	return format == "pdf" || format == "djvu" || format == "fb2" || format == "epub"
}

func (s *ftpOriginals) contains(location string) bool {
	return strings.HasPrefix(location, s.root+"/") && path.Clean(location) == location && !strings.ContainsAny(location, "\\\r\n\x00")
}

func (s *ftpOriginals) Open(ctx context.Context, location string) (io.ReadCloser, error) {
	if !s.contains(location) {
		return nil, domain.ErrValidation
	}
	session, err := s.connect(ctx)
	if err != nil {
		return nil, err
	}
	response, err := session.conn.Retr(location)
	if err != nil {
		session.close()
		return nil, err
	}
	return &ftpReader{response: response, session: session}, nil
}

func (s *ftpOriginals) MoveBook(ctx context.Context, input, hash, format string) (string, error) {
	location := s.BookPath(hash, format)
	if location == "" {
		return "", domain.ErrValidation
	}
	file, err := os.Open(input)
	if err != nil {
		return "", err
	}
	defer file.Close()
	session, err := s.connect(ctx)
	if err != nil {
		return "", err
	}
	defer session.close()
	if err := ftpMkdirAll(session.conn, path.Dir(location)); err != nil {
		return "", err
	}
	staging := path.Join(path.Dir(location), ".book-hub-"+uuid.NewString())
	if err := session.conn.Stor(staging, contextReader{ctx, file}); err != nil {
		s.cleanup(staging)
		return "", err
	}
	if err := ctx.Err(); err != nil {
		s.cleanup(staging)
		return "", err
	}
	if err := session.conn.Rename(staging, location); err != nil {
		s.cleanup(staging)
		return "", err
	}
	return location, nil
}

func (s *ftpOriginals) cleanup(location string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if session, err := s.connect(ctx); err == nil {
		defer session.close()
		_ = session.conn.Delete(location)
	}
}

func ftpMkdirAll(conn *ftp.ServerConn, directory string) error {
	current := ""
	for _, component := range strings.Split(strings.TrimPrefix(directory, "/"), "/") {
		current += "/" + component
		if err := conn.MakeDir(current); err != nil {
			if err := conn.ChangeDir(current); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *ftpOriginals) Delete(ctx context.Context, location string) error {
	if !s.contains(location) {
		return domain.ErrValidation
	}
	session, err := s.connect(ctx)
	if err != nil {
		return err
	}
	defer session.close()
	err = session.conn.Delete(location)
	if ftpUnavailablePath(err) {
		missing, lookupErr := ftpPathMissing(session.conn, location)
		if lookupErr == nil && missing {
			return nil
		}
	}
	return err
}

func ftpUnavailablePath(err error) bool {
	var response *textproto.Error
	return errors.As(err, &response) && response.Code == ftp.StatusFileUnavailable
}

// A 550 response can mean either absence or denied access; only a parent listing
// proving the name absent makes a failed delete idempotently successful.
func ftpPathMissing(conn *ftp.ServerConn, location string) (bool, error) {
	if location == "/" {
		return false, nil
	}
	parent := path.Dir(location)
	entries, err := ftpList(conn, parent)
	if err != nil {
		if ftpUnavailablePath(err) {
			missing, lookupErr := ftpPathMissing(conn, parent)
			if lookupErr != nil || missing {
				return missing, lookupErr
			}
		}
		return false, err
	}
	for _, entry := range entries {
		if entry.Name == path.Base(location) {
			return false, nil
		}
	}
	return true, nil
}

func (s *ftpOriginals) Empty(ctx context.Context) (bool, error) {
	session, err := s.connect(ctx)
	if err != nil {
		return false, err
	}
	defer session.close()
	directories := []string{s.root}
	for len(directories) > 0 {
		directory := directories[len(directories)-1]
		directories = directories[:len(directories)-1]
		entries, err := ftpList(session.conn, directory)
		if err != nil {
			if directory == s.root && ftpUnavailablePath(err) {
				missing, lookupErr := ftpPathMissing(session.conn, directory)
				if lookupErr == nil && missing {
					return true, nil
				}
			}
			return false, err
		}
		for _, entry := range entries {
			if entry.Name == "." || entry.Name == ".." {
				continue
			}
			if path.Base(entry.Name) != entry.Name || strings.ContainsAny(entry.Name, "\\\r\n\x00") {
				return false, fmt.Errorf("invalid FTP directory entry")
			}
			if entry.Type != ftp.EntryTypeFolder {
				return false, nil
			}
			directories = append(directories, path.Join(directory, entry.Name))
		}
	}
	return true, nil
}

// LIST -a with a path is not consistently supported by FTP servers. Selecting
// the absolute directory first keeps hidden entries visible on those servers.
func ftpList(conn *ftp.ServerConn, directory string) ([]*ftp.Entry, error) {
	if err := conn.ChangeDir(directory); err != nil {
		return nil, err
	}
	return conn.List("")
}

// Each operation owns its control/data connections. Cancellation closes raw
// connections, without concurrent commands on the non-thread-safe FTP client.
type ftpSession struct {
	conn   *ftp.ServerConn
	mu     sync.Mutex
	raw    []net.Conn
	stop   func() bool
	cancel context.CancelFunc
}

func (s *ftpOriginals) connect(parent context.Context) (*ftpSession, error) {
	ctx, cancel := context.WithCancel(parent)
	session := &ftpSession{cancel: cancel}
	session.stop = context.AfterFunc(ctx, session.closeConnections)
	dial := func(network, address string) (net.Conn, error) {
		conn, err := (&net.Dialer{Timeout: ftpIdleTimeout}).DialContext(ctx, network, address)
		if err != nil {
			return nil, err
		}
		session.mu.Lock()
		if err := ctx.Err(); err != nil {
			session.mu.Unlock()
			conn.Close()
			return nil, err
		}
		session.raw = append(session.raw, conn)
		control := len(session.raw) == 1
		session.mu.Unlock()
		tracked := net.Conn(ftpIdleConn{conn})
		// The FTP library delegates both sockets to this custom dialer.
		// It upgrades explicit control itself; implicit control and all
		// protected data sockets must be wrapped here with the original hostname.
		if s.tlsConfig != nil && (!control || s.mode == "ftps-implicit") {
			protected := tls.Client(tracked, s.tlsConfig.Clone())
			tracked = protected
			if !control {
				tracked = &ftpTLSDataConn{Conn: protected}
			}
		}
		return tracked, nil
	}
	options := []ftp.DialOption{ftp.DialWithDialFunc(dial), ftp.DialWithForceListHidden(true)}
	if s.mode == "ftps-explicit" {
		options = append(options, ftp.DialWithExplicitTLS(s.tlsConfig))
	}
	if s.mode == "ftps-implicit" {
		options = append(options, ftp.DialWithTLS(s.tlsConfig))
	}
	conn, err := ftp.Dial(s.address, options...)
	if err == nil {
		session.conn = conn
		err = conn.Login(s.user, s.password)
	}
	if err != nil {
		session.close()
		return nil, err
	}
	return session, nil
}

// Complete the TLS close handshake before closing the TCP socket. Closing it
// with the peer's close_notify unread can reset the connection and truncate an
// otherwise successful upload on FTPS servers. The tracked raw connection keeps
// this wait bounded by its idle deadline and cancellation.
type ftpTLSDataConn struct {
	*tls.Conn
	once sync.Once
	err  error
}

func (c *ftpTLSDataConn) Close() error {
	c.once.Do(func() {
		writeErr := c.CloseWrite()
		_, readErr := io.Copy(io.Discard, c.Conn)
		c.err = errors.Join(writeErr, readErr, c.Conn.Close())
	})
	return c.err
}

func (s *ftpSession) closeConnections() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, conn := range s.raw {
		_ = conn.Close()
	}
}

func (s *ftpSession) close() {
	s.stop()
	s.cancel()
	s.closeConnections()
}

type ftpIdleConn struct{ net.Conn }

func (c ftpIdleConn) Read(data []byte) (int, error) {
	_ = c.SetReadDeadline(time.Now().Add(ftpIdleTimeout))
	return c.Conn.Read(data)
}

func (c ftpIdleConn) Write(data []byte) (int, error) {
	_ = c.SetWriteDeadline(time.Now().Add(ftpIdleTimeout))
	return c.Conn.Write(data)
}

type ftpReader struct {
	response *ftp.Response
	session  *ftpSession
	once     sync.Once
	err      error
}

func (r *ftpReader) Read(data []byte) (int, error) {
	n, err := r.response.Read(data)
	if err == io.EOF {
		if closeErr := r.Close(); closeErr != nil {
			return n, closeErr
		}
	}
	return n, err
}

func (r *ftpReader) Close() error {
	r.once.Do(func() {
		r.err = r.response.Close()
		r.session.close()
	})
	return r.err
}
func ftpTLSConfig(cfg config.Config) (*tls.Config, error) {
	if cfg.BookStorage == "ftp" {
		return nil, nil
	}
	host, _, err := net.SplitHostPort(cfg.FTPAddr)
	if err != nil {
		return nil, err
	}
	roots, err := x509.SystemCertPool()
	if err != nil {
		return nil, fmt.Errorf("load trusted certificate authorities: %w", err)
	}
	if cfg.FTPCAFile != "" {
		pem, err := os.ReadFile(cfg.FTPCAFile)
		if err != nil {
			return nil, fmt.Errorf("BOOK_HUB_FTP_CA_FILE: %w", err)
		}
		if !roots.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("BOOK_HUB_FTP_CA_FILE contains no certificates")
		}
	}
	return &tls.Config{RootCAs: roots, ServerName: host, MinVersion: tls.VersionTLS12}, nil
}
