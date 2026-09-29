package com.example.novelreader.reader.entity;

import com.example.novelreader.auth.ReaderUser;
import com.example.novelreader.book.entity.Book;
import com.example.novelreader.book.entity.Chapter;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "reading_progress")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ReadingProgress {

	@Id
	private UUID id;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "user_id", nullable = false)
	private ReaderUser user;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "book_id", nullable = false)
	private Book book;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "chapter_id", nullable = false)
	private Chapter chapter;

	@Column(name = "character_position", nullable = false)
	private int characterPosition;

	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt;

	public ReadingProgress(UUID id, ReaderUser user, Book book, Chapter chapter, int characterPosition) {
		this.id = id;
		this.user = user;
		this.book = book;
		update(chapter, characterPosition);
	}

	public void update(Chapter chapter, int characterPosition) {
		this.chapter = chapter;
		this.characterPosition = characterPosition;
		this.updatedAt = Instant.now();
	}
}
