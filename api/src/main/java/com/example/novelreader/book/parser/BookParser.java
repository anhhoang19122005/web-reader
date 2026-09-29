package com.example.novelreader.book.parser;

import com.example.novelreader.book.entity.BookFileType;
import java.nio.file.Path;

public interface BookParser {

	BookFileType fileType();

	ParsedBook parse(Path file);
}
