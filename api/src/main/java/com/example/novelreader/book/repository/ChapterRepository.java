package com.example.novelreader.book.repository;

import com.example.novelreader.book.entity.Chapter;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChapterRepository extends JpaRepository<Chapter, UUID> {

	Optional<Chapter> findByIdAndBookId(UUID id, UUID bookId);
}
