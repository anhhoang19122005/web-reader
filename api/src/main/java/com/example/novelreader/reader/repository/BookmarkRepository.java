package com.example.novelreader.reader.repository;

import com.example.novelreader.reader.entity.Bookmark;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BookmarkRepository extends JpaRepository<Bookmark, UUID> {

	List<Bookmark> findByUserIdAndBookIdOrderByCreatedAtDesc(UUID userId, UUID bookId);

	Optional<Bookmark> findByIdAndUserIdAndBookId(UUID id, UUID userId, UUID bookId);
}
