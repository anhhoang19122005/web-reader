package com.example.novelreader.storage;

import java.nio.file.Path;

public interface StorageProvider {

	String store(Path source, String key);

	String store(byte[] content, String key);

	byte[] read(String key);

	void delete(String key);
}
