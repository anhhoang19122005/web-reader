package com.example.novelreader.book.entity;

import com.example.novelreader.common.exception.ApiException;
import java.util.Locale;
import org.springframework.http.HttpStatus;

public enum BookFileType {
	EPUB, PDF;

	public static BookFileType fromFilename(String filename) {
		if (filename != null && filename.toLowerCase(Locale.ROOT).endsWith(".epub")) {
			return EPUB;
		}
		if (filename != null && filename.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
			return PDF;
		}
		throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_FILE_TYPE", "Chỉ hỗ trợ tệp EPUB hoặc PDF.");
	}
}
