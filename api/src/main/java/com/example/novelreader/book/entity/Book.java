package com.example.novelreader.book.entity;

import com.example.novelreader.auth.ReaderUser;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "books")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Book {

	@Id
	private UUID id;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "user_id", nullable = false)
	private ReaderUser user;

	@Column(nullable = false, length = 500)
	private String title;

	@Column(nullable = false, length = 500)
	private String author;

	@Column(name = "cover_storage_key")
	private String coverStorageKey;

	@Column(name = "original_file_storage_key", nullable = false)
	private String originalFileStorageKey;

	@Enumerated(EnumType.STRING)
	@Column(name = "file_type", nullable = false, length = 20)
	private BookFileType fileType;

	@Column(nullable = false, length = 20)
	private String language;

	@Column(name = "created_at", nullable = false)
	private Instant createdAt;

	@OneToMany(mappedBy = "book", cascade = CascadeType.ALL, orphanRemoval = true)
	@OrderBy("chapterNumber ASC")
	private List<Chapter> chapters = new ArrayList<>();

	public Book(UUID id, ReaderUser user, String title, String author, String coverStorageKey, String originalFileStorageKey, BookFileType fileType, String language) {
		this.id = id;
		this.user = user;
		this.title = title;
		this.author = author;
		this.coverStorageKey = coverStorageKey;
		this.originalFileStorageKey = originalFileStorageKey;
		this.fileType = fileType;
		this.language = language;
		this.createdAt = Instant.now();
	}

	public void addChapter(Chapter chapter) {
		chapters.add(chapter);
	}
}
