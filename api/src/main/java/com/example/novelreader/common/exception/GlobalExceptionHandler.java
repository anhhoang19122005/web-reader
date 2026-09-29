package com.example.novelreader.common.exception;

import com.example.novelreader.common.dto.ApiErrorResponse;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

@RestControllerAdvice
public class GlobalExceptionHandler {

	@ExceptionHandler(ApiException.class)
	ResponseEntity<ApiErrorResponse> handleApiException(ApiException exception) {
		return ResponseEntity.status(exception.getStatus())
			.body(new ApiErrorResponse(exception.getCode(), exception.getMessage(), exception.getDetails()));
	}

	@ExceptionHandler(MaxUploadSizeExceededException.class)
	ResponseEntity<ApiErrorResponse> handleFileTooLarge() {
		return ResponseEntity.status(HttpStatus.CONTENT_TOO_LARGE)
			.body(new ApiErrorResponse("FILE_TOO_LARGE", "Tệp vượt quá giới hạn 50 MB.", Map.of()));
	}

	@ExceptionHandler(MethodArgumentNotValidException.class)
	ResponseEntity<ApiErrorResponse> handleValidation(MethodArgumentNotValidException exception) {
		Map<String, String> details = exception.getBindingResult().getFieldErrors().stream()
			.collect(Collectors.toMap(error -> error.getField(), error -> error.getDefaultMessage(), (first, ignored) -> first));
		return ResponseEntity.badRequest()
			.body(new ApiErrorResponse("VALIDATION_ERROR", "Dữ liệu không hợp lệ.", details));
	}

	@ExceptionHandler(Exception.class)
	ResponseEntity<ApiErrorResponse> handleUnexpectedException() {
		return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
			.body(new ApiErrorResponse("INTERNAL_ERROR", "Không thể xử lý yêu cầu.", Map.of()));
	}
}
