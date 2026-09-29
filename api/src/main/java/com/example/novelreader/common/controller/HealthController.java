package com.example.novelreader.common.controller;

import com.example.novelreader.common.dto.HealthResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/health")
public class HealthController {

	@GetMapping
	public HealthResponse health() {
		return new HealthResponse("UP");
	}
}
