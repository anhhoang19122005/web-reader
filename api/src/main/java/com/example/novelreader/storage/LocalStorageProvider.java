package com.example.novelreader.storage;

import com.example.novelreader.common.exception.ApiException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "app.storage.provider", havingValue = "local", matchIfMissing = true)
public class LocalStorageProvider implements StorageProvider {

	private final Path rootPath;

	public LocalStorageProvider(@Value("${app.storage.local-path}") String localPath) {
		this.rootPath = Path.of(localPath).toAbsolutePath().normalize();
	}

	@Override
	public String store(Path source, String key) {
		Path destination = resolve(key);
		try {
			Files.createDirectories(destination.getParent());
			Files.copy(source, destination, StandardCopyOption.COPY_ATTRIBUTES);
			return key;
		} catch (IOException exception) {
			throw storageFailure(exception);
		}
	}

	@Override
	public String store(byte[] content, String key) {
		Path destination = resolve(key);
		try {
			Files.createDirectories(destination.getParent());
			Files.write(destination, content, StandardOpenOption.CREATE_NEW);
			return key;
		} catch (IOException exception) {
			throw storageFailure(exception);
		}
	}

	@Override
	public byte[] read(String key) {
		try {
			return Files.readAllBytes(resolve(key));
		} catch (IOException exception) {
			throw new ApiException(HttpStatus.NOT_FOUND, "STORAGE_NOT_FOUND", "Không tìm thấy tệp âm thanh.");
		}
	}

	@Override
	public void delete(String key) {
		try {
			Files.deleteIfExists(resolve(key));
		} catch (IOException exception) {
			throw storageFailure(exception);
		}
	}

	private Path resolve(String key) {
		Path destination = rootPath.resolve(key).normalize();
		if (!destination.startsWith(rootPath)) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_STORAGE_KEY", "Đường dẫn tệp không hợp lệ.");
		}
		return destination;
	}

	private ApiException storageFailure(IOException exception) {
		return new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "STORAGE_FAILED", "Không thể lưu tệp.");
	}
}
