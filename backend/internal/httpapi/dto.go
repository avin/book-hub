package httpapi

import (
	"time"

	"book-hub/internal/domain"
)

type loginRequest struct {
	Login    string `json:"login"`
	Password string `json:"password"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

type bookQueryRequest struct {
	SearchField string   `json:"search_field"`
	Limit       *int     `json:"limit"`
	Offset      *int     `json:"offset"`
	Sort        string   `json:"sort"`
	Tags        []string `json:"tags"`
	Favorite    *bool    `json:"favorite"`
	Q           string   `json:"q"`
}

type bookPatchRequest struct {
	Title       *string   `json:"title"`
	Description *string   `json:"description"`
	Tags        *[]string `json:"tags"`
	Favorite    *bool     `json:"favorite"`
}

type progressRequest struct {
	ProgressPercent float64 `json:"progress_percent"`
}

type tagsResponse struct {
	Items []string `json:"items"`
}

type userDTO struct {
	ID         string `json:"id"`
	Login      string `json:"login"`
	IsActive   bool   `json:"is_active"`
	QuotaBytes int64  `json:"quota_bytes"`
	UsedBytes  int64  `json:"used_bytes"`
	CreatedAt  string `json:"created_at"`
}

type bookResponse struct {
	ID              string   `json:"id"`
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	Tags            []string `json:"tags"`
	Favorite        bool     `json:"favorite"`
	Format          string   `json:"format"`
	SizeBytes       int64    `json:"size_bytes"`
	ProgressPercent float64  `json:"progress_percent"`
	CreatedAt       string   `json:"created_at"`
	LastOpenedAt    string   `json:"last_opened_at"`
	UpdatedAt       string   `json:"updated_at"`
}

type progressResponse struct {
	ProgressPercent float64 `json:"progress_percent"`
}

func userResponse(user domain.User) userDTO {
	return userDTO{
		ID:         user.ID.String(),
		Login:      user.Login,
		IsActive:   user.IsActive,
		QuotaBytes: user.QuotaBytes,
		UsedBytes:  user.UsedBytes,
		CreatedAt:  user.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func bookDTO(book domain.Book) bookResponse {
	return bookResponse{
		ID:              book.ID.String(),
		Title:           book.Title,
		Description:     book.Description,
		Tags:            book.Tags,
		Favorite:        book.Favorite,
		Format:          book.Format,
		SizeBytes:       book.SizeBytes,
		ProgressPercent: book.ProgressPercent,
		CreatedAt:       book.CreatedAt.UTC().Format(time.RFC3339),
		LastOpenedAt:    book.LastOpenedAt.UTC().Format(time.RFC3339),
		UpdatedAt:       book.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func progressDTO(progress domain.ReadingProgress) progressResponse {
	return progressResponse{ProgressPercent: progress.ProgressPercent}
}
