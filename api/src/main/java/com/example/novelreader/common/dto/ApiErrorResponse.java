package com.example.novelreader.common.dto;

import java.util.Map;

public record ApiErrorResponse(String code, String message, Map<String, ?> details) {
}
