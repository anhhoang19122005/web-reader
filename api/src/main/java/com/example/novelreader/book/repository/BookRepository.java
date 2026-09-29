package com.example.novelreader.book.repository;

import com.example.novelreader.book.entity.Book;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BookRepository extends JpaRepository<Book, UUID> {

	List<Book> findByUserIdOrderByCreatedAtDesc(UUID userId);

	Optional<Book> findByIdAndUserId(UUID id, UUID userId);
}
