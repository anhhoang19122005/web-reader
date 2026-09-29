create table reading_progress (
    id uuid primary key,
    user_id uuid not null references users(id),
    book_id uuid not null references books(id) on delete cascade,
    chapter_id uuid not null references chapters(id) on delete cascade,
    character_position integer not null check (character_position >= 0),
    updated_at timestamp with time zone not null,
    unique (user_id, book_id)
);
