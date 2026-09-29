package com.example.novelreader.auth;

import com.example.novelreader.common.exception.ApiException;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class CurrentUserService {

	private static final String SINGLE_USER_EMAIL = "reader@local";

	private final ReaderUserRepository readerUserRepository;

	public UUID currentUserId() {
		return readerUserRepository.findByEmail(SINGLE_USER_EMAIL)
			.map(ReaderUser::getId)
			.orElseThrow(() -> new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "SINGLE_USER_MISSING", "Không tìm thấy người dùng mặc định."));
	}
}
