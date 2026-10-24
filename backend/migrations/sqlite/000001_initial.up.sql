create table users (
    id text primary key not null,
    login text not null unique check (length(login) between 3 and 64 and login not glob '*[^a-z0-9_.-]*'),
    password_hash text not null,
    is_active integer not null default 0 check (is_active in (0, 1)),
    quota_bytes integer not null check (quota_bytes >= 0),
    settings_json text not null default '{}' check (json_valid(settings_json)),
    created_at datetime not null default (bookhub_now()),
    updated_at datetime not null default (bookhub_now())
);
create table book_files (
    id text primary key not null,
    sha256 text not null unique check (length(sha256) = 64 and sha256 not glob '*[^a-f0-9]*'),
    storage_path text not null,
    size_bytes integer not null check (size_bytes >= 0),
    format text not null check (format in ('pdf', 'fb2', 'epub', 'djvu')),
    created_at datetime not null default (bookhub_now())
);
create table user_books (
    id text primary key not null,
    user_id text not null references users(id) on delete cascade,
    book_file_id text not null references book_files(id) on delete restrict,
    title text not null check (length(title) between 1 and 512),
    favorite integer not null default 0 check (favorite in (0, 1)),
    cover_path text,
    cover_thumbnail_path text,
    progress_percent real not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
    created_at datetime not null default (bookhub_now()),
    last_opened_at datetime not null default (bookhub_now()),
    updated_at datetime not null default (bookhub_now()),
    unique (user_id, book_file_id)
);
create index user_books_user_id_idx on user_books(user_id);
create index user_books_book_file_id_idx on user_books(book_file_id);
create index user_books_relevance_idx on user_books(user_id, last_opened_at desc, created_at desc, id desc);
create table tags (
    id text primary key not null,
    user_id text not null references users(id) on delete cascade,
    name text not null check (length(name) between 1 and 64 and name = bookhub_lower(name)),
    created_at datetime not null default (bookhub_now()),
    unique (user_id, name)
);
create index tags_user_id_idx on tags(user_id);
create table user_book_tags (
    user_book_id text not null references user_books(id) on delete cascade,
    tag_id text not null references tags(id) on delete cascade,
    primary key (user_book_id, tag_id)
);
create index user_book_tags_tag_id_idx on user_book_tags(tag_id);
create table sessions (
    id text primary key not null,
    user_id text not null references users(id) on delete cascade,
    token_hash text not null unique check (length(token_hash) = 64 and token_hash not glob '*[^a-f0-9]*'),
    expires_at datetime not null,
    created_at datetime not null default (bookhub_now()),
    revoked_at datetime
);
create index sessions_user_id_idx on sessions(user_id);
create index sessions_active_token_idx on sessions(token_hash) where revoked_at is null;
