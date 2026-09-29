package com.example.novelreader.storage;

import com.example.novelreader.common.exception.ApiException;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "app.storage.provider", havingValue = "supabase")
public class SupabaseStorageProvider implements StorageProvider {

	private final String supabaseUrl;
	private final String serviceRoleKey;
	private final String bucket;
	private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

	public SupabaseStorageProvider(
		@Value("${app.storage.supabase-url:}") String supabaseUrl,
		@Value("${app.storage.supabase-service-role-key:}") String serviceRoleKey,
		@Value("${app.storage.supabase-bucket:reader}") String bucket) {
		this.supabaseUrl = supabaseUrl.replaceAll("/+$", "");
		this.serviceRoleKey = serviceRoleKey;
		this.bucket = bucket;
	}

	@Override
	public String store(Path source, String key) {
		try {
			return upload(Files.readAllBytes(source), key);
		} catch (IOException exception) {
			throw failure();
		}
	}

	@Override
	public String store(byte[] content, String key) {
		return upload(content, key);
	}

	@Override
	public byte[] read(String key) {
		validate(key);
		HttpRequest request = requestBuilder(key).GET().build();
		try {
			HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
			if (response.statusCode() == 404) {
				throw new ApiException(HttpStatus.NOT_FOUND, "STORAGE_NOT_FOUND", "Không tìm thấy tệp.");
			}
			if (response.statusCode() / 100 != 2) throw failure();
			return response.body();
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
			throw failure();
		} catch (IOException exception) {
			throw failure();
		}
	}

	@Override
	public void delete(String key) {
		validate(key);
		HttpRequest request = requestBuilder(key).DELETE().build();
		try {
			HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
			if (response.statusCode() != 404 && response.statusCode() / 100 != 2) throw failure();
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
			throw failure();
		} catch (IOException exception) {
			throw failure();
		}
	}

	private String upload(byte[] content, String key) {
		validate(key);
		HttpRequest request = requestBuilder(key)
			.header("Content-Type", contentType(key))
			.header("x-upsert", "true")
			.POST(HttpRequest.BodyPublishers.ofByteArray(content))
			.build();
		try {
			HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
			if (response.statusCode() / 100 != 2) throw failure();
			return key;
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
			throw failure();
		} catch (IOException exception) {
			throw failure();
		}
	}

	private HttpRequest.Builder requestBuilder(String key) {
		return HttpRequest.newBuilder(URI.create(supabaseUrl + "/storage/v1/object/" + encode(bucket) + "/" + encodePath(key)))
			.timeout(Duration.ofSeconds(60))
			.header("Authorization", "Bearer " + serviceRoleKey)
			.header("apikey", serviceRoleKey);
	}

	private String encodePath(String key) {
		StringBuilder encoded = new StringBuilder();
		String[] segments = key.split("/", -1);
		for (int index = 0; index < segments.length; index++) {
			if (index > 0) encoded.append('/');
			encoded.append(encode(segments[index]));
		}
		return encoded.toString();
	}

	private String encode(String value) {
		return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
	}

	private String contentType(String key) {
		String lower = key.toLowerCase();
		if (lower.endsWith(".epub")) return "application/epub+zip";
		if (lower.endsWith(".pdf")) return "application/pdf";
		if (lower.endsWith(".mp3")) return "audio/mpeg";
		if (lower.endsWith(".wav")) return "audio/wav";
		if (lower.endsWith(".png")) return "image/png";
		if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
		return "application/octet-stream";
	}

	private void validate(String key) {
		if (key == null || key.isBlank() || key.contains("..") || key.startsWith("/")) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_STORAGE_KEY", "Đường dẫn tệp không hợp lệ.");
		}
		if (supabaseUrl.isBlank() || serviceRoleKey.isBlank() || bucket.isBlank()) throw failure();
	}

	private ApiException failure() {
		return new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "STORAGE_FAILED", "Không thể lưu tệp.");
	}
}
