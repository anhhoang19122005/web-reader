package com.example.novelreader.auth;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReaderUserRepository extends JpaRepository<ReaderUser, UUID> {

	Optional<ReaderUser> findByEmail(String email);
}
