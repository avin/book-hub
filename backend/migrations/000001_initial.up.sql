create table users (
    id uuid primary key,
    login text not null,
    password_hash text not null,
    is_active boolean not null default false,
    quota_bytes bigint not null check (quota_bytes >= 0),
    settings_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint users_login_format_check check (login ~ '^[a-z0-9_.-]{3,64}$')
);

create unique index users_login_lower_idx on users (lower(login));

create table book_files (
    id uuid primary key,
    sha256 text not null unique,
    storage_path text not null,
    size_bytes bigint not null check (size_bytes >= 0),
    format text not null check (format in ('pdf', 'fb2')),
    created_at timestamptz not null default now(),
    constraint book_files_sha256_check check (sha256 ~ '^[a-f0-9]{64}$')
);

create table user_books (
    id uuid primary key,
    user_id uuid not null references users(id) on delete cascade,
    book_file_id uuid not null references book_files(id) on delete restrict,
    title text not null,
    favorite boolean not null default false,
    cover_path text,
    cover_thumbnail_path text,
    progress_percent double precision not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
    created_at timestamptz not null default now(),
    last_opened_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, book_file_id),
    constraint user_books_title_check check (char_length(title) between 1 and 512)
);

create index user_books_user_id_idx on user_books (user_id);
create index user_books_book_file_id_idx on user_books (book_file_id);

create table tags (
    id uuid primary key,
    user_id uuid not null references users(id) on delete cascade,
    name text not null,
    created_at timestamptz not null default now(),
    unique (user_id, name),
    constraint tags_name_check check (char_length(name) between 1 and 64 and name = lower(name))
);

create index tags_user_id_idx on tags (user_id);

create table user_book_tags (
    user_book_id uuid not null references user_books(id) on delete cascade,
    tag_id uuid not null references tags(id) on delete cascade,
    primary key (user_book_id, tag_id)
);

create index user_book_tags_tag_id_idx on user_book_tags (tag_id);

create index user_books_relevance_idx on user_books (user_id, last_opened_at desc, created_at desc, id desc);

create table sessions (
    id uuid primary key,
    user_id uuid not null references users(id) on delete cascade,
    token_hash text not null unique,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    revoked_at timestamptz,
    constraint sessions_token_hash_check check (token_hash ~ '^[a-f0-9]{64}$')
);

create index sessions_user_id_idx on sessions (user_id);
create index sessions_active_token_idx on sessions (token_hash) where revoked_at is null;
