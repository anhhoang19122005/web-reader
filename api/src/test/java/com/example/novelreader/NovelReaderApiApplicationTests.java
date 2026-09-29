package com.example.novelreader;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class NovelReaderApiApplicationTests {

	@Autowired
	private MockMvc mockMvc;

	@Test
	void contextLoads() {
	}

	@Test
	void healthEndpointIsAvailableWithoutAuthentication() throws Exception {
		mockMvc.perform(get("/api/health").contextPath("/api"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("UP"));
	}

	@Test
	void browserPreflightAllowsReaderWrites() throws Exception {
		mockMvc.perform(options("/api/reader/progress/00000000-0000-0000-0000-000000000001")
				.contextPath("/api")
				.header("Origin", "http://localhost:3000")
				.header("Access-Control-Request-Method", "PUT")
				.header("Access-Control-Request-Headers", "content-type"))
			.andExpect(status().isOk());
	}

}
