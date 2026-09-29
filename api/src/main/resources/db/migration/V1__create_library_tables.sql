create table users (
    id uuid primary key,
    email varchar(320) not null unique,
    password_hash varchar(255),
    created_at timestamp with time zone not null default current_timestamp
);

insert into users (id, email) values
    ('00000000-0000-0000-0000-000000000001', 'reader@local');

create table books (
    id uuid primary key,
    user_id uuid not null references users(id),
    title varchar(500) not null,
    author varchar(500) not null,
    cover_storage_key varchar(1000),
    original_file_storage_key varchar(1000) not null,
    file_type varchar(20) not null,
    language varchar(20) not null,
    created_at timestamp with time zone not null default current_timestamp
);

create index idx_books_user_created_at on books (user_id, created_at desc);

create table chapters (
    id uuid primary key,
    book_id uuid not null references books(id) on delete cascade,
    chapter_number integer not null,
    title varchar(500) not null,
    content_html text not null,
    plain_text text not null,
    content_hash varchar(64) not null,
    unique (book_id, chapter_number)
);

create index idx_chapters_book_number on chapters (book_id, chapter_number);
