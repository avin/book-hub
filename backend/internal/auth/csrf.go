package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"strings"
)

type CSRFManager struct {
	secret []byte
}

func NewCSRFManager(secret string) CSRFManager {
	return CSRFManager{secret: []byte(secret)}
}

func (m CSRFManager) NewToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	rawPart := base64.RawURLEncoding.EncodeToString(raw)
	signature := m.sign(rawPart)
	return rawPart + "." + signature, nil
}

func (m CSRFManager) Verify(token string) bool {
	rawPart, signature, ok := strings.Cut(token, ".")
	if !ok || rawPart == "" || signature == "" {
		return false
	}
	expected := m.sign(rawPart)
	return subtle.ConstantTimeCompare([]byte(signature), []byte(expected)) == 1
}

func (m CSRFManager) sign(rawPart string) string {
	mac := hmac.New(sha256.New, m.secret)
	mac.Write([]byte(rawPart))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
