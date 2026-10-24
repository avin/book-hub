package files

import (
	"context"
	"errors"
	"io"
	"os"
	"path"
	"strings"
	"time"

	"book-hub/internal/config"
	"book-hub/internal/domain"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type s3Originals struct {
	client         *s3.Client
	bucket, prefix string
}

func newS3Originals(cfg config.Config) *s3Originals {
	options := s3.Options{
		Region:                     cfg.S3Region,
		Credentials:                credentials.NewStaticCredentialsProvider(cfg.S3AccessKeyID, cfg.S3SecretAccessKey, ""),
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
	}
	if cfg.S3Endpoint != "" {
		options.BaseEndpoint = aws.String(cfg.S3Endpoint)
		options.UsePathStyle = true
	}
	return &s3Originals{client: s3.New(options), bucket: cfg.S3Bucket, prefix: cfg.S3Prefix}
}

func (s *s3Originals) BookPath(hash, format string) string {
	if !validOriginalName(hash, format) {
		return ""
	}
	return path.Join(s.prefix, hash[:2], hash+"."+format)
}

func (s *s3Originals) contains(location string) bool {
	return strings.HasPrefix(location, s.prefix+"/") && path.Clean(location) == location && !strings.ContainsAny(location, "\\\r\n\x00")
}

func (s *s3Originals) Open(ctx context.Context, location string) (io.ReadCloser, error) {
	if !s.contains(location) {
		return nil, domain.ErrValidation
	}
	object, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(location)})
	if err != nil {
		return nil, err
	}
	return object.Body, nil
}

func (s *s3Originals) MoveBook(ctx context.Context, source, hash, format string) (string, error) {
	location := s.BookPath(hash, format)
	if location == "" {
		return "", domain.ErrValidation
	}
	file, err := os.Open(source)
	if err != nil {
		return "", err
	}
	defer file.Close()
	// A seekable file avoids buffering entire originals. Multipart uploads publish
	// only after completion; abandoned parts are removed without deleting a final key.
	uploader := manager.NewUploader(s.client, func(u *manager.Uploader) { u.Concurrency = 2 })
	_, err = uploader.Upload(ctx, &s3.PutObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(location), Body: file})
	if err != nil {
		var multipart manager.MultiUploadFailure
		if errors.As(err, &multipart) && multipart.UploadID() != "" {
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			_, _ = s.client.AbortMultipartUpload(cleanup, &s3.AbortMultipartUploadInput{Bucket: aws.String(s.bucket), Key: aws.String(location), UploadId: aws.String(multipart.UploadID())})
		}
		return "", err
	}
	return location, nil
}

func (s *s3Originals) Delete(ctx context.Context, location string) error {
	if !s.contains(location) {
		return domain.ErrValidation
	}
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(location)})
	return err
}

func (s *s3Originals) Empty(ctx context.Context) (bool, error) {
	objects, err := s.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{Bucket: aws.String(s.bucket), Prefix: aws.String(s.prefix + "/"), MaxKeys: aws.Int32(1)})
	if err != nil {
		return false, err
	}
	return len(objects.Contents) == 0, nil
}
