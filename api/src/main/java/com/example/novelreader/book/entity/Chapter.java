package com.example.novelreader.book.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "chapters")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Chapter {

	@Id
	private UUID id;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "book_id", nullable = false)
	private Book book;

	@Column(name = "chapter_number", nullable = false)
	private int chapterNumber;

	@Column(nullable = false, length = 500)
	private String title;

	@Column(name = "content_html", nullable = false, columnDefinition = "text")
	private String contentHtml;

	@Column(name = "plain_text", nullable = false, columnDefinition = "text")
	private String plainText;

	@Column(name = "content_hash", nullable = false, length = 64)
	private String contentHash;

	public Chapter(UUID id, Book book, int chapterNumber, String title, String contentHtml, String plainText, String contentHash) {
		this.id = id;
		this.book = book;
		this.chapterNumber = chapterNumber;
		this.title = title;
		this.contentHtml = contentHtml;
		this.plainText = plainText;
		this.contentHash = contentHash;
	}
}
