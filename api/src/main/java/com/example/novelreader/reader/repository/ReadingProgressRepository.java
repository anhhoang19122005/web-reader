package com.example.novelreader.reader.repository;

import com.example.novelreader.reader.entity.ReadingProgress;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReadingProgressRepository extends JpaRepository<ReadingProgress, UUID> {

	Optional<ReadingProgress> findByUserIdAndBookId(UUID userId, UUID bookId);
}
