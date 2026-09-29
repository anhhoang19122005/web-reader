package com.example.novelreader.book.parser;

import java.util.List;

public record ParsedBook(String title, String author, byte[] cover, String coverExtension, List<ParsedChapter> chapters) {
}
