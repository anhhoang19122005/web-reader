create table audio_chunks (
    id uuid primary key,
    chapter_id uuid not null references chapters(id) on delete cascade,
    chunk_index integer not null,
    text_hash varchar(64) not null,
    text text not null,
    voice_id varchar(100) not null,
    speaking_rate double precision not null,
    pitch double precision not null,
    volume double precision not null,
    start_character integer not null,
    end_character integer not null,
    audio_storage_key varchar(1000) not null,
    mime_type varchar(100) not null,
    duration_ms integer not null,
    created_at timestamp with time zone not null,
    unique (chapter_id, chunk_index, voice_id, speaking_rate, pitch, volume, text_hash)
);

create table bookmarks (
    id uuid primary key,
    user_id uuid not null references users(id),
    book_id uuid not null references books(id) on delete cascade,
    chapter_id uuid not null references chapters(id) on delete cascade,
    character_position integer not null check (character_position >= 0),
    note varchar(1000),
    created_at timestamp with time zone not null
);

create index idx_audio_chunks_chapter on audio_chunks (chapter_id, chunk_index);
create index idx_bookmarks_user_book on bookmarks (user_id, book_id, created_at desc);
