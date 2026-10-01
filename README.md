# Novel Reader

## Bản Go dùng cho Vercel

```powershell
.\start-reader-go.ps1
```

Lệnh này tự cài Go nếu thiếu, chạy migration MongoDB Atlas, Go API tại `http://localhost:8081/api` và web tại `http://localhost:3000`. Backend mới nằm trong [`go-api`](go-api/README.md), dùng Edge-TTS trực tiếp bằng Go và thêm SaydiVoice khi có `SAYDI_API_KEYS`, cùng cấu hình deploy Vercel + Supabase.

Thư mục `api` giữ lại backend Spring Boot cũ để tham chiếu và rollback; web dùng API Go khi chạy bằng `start-reader-go.ps1`.

## Bản Spring Boot cũ

```powershell
.\start-reader.ps1
```

Lệnh trên khởi động PostgreSQL, tự cài `edge-tts` nếu thiếu và mở API, web trong hai cửa sổ PowerShell riêng.

API health: `http://localhost:8080/api/health`

Mở `http://localhost:3000/library` để upload EPUB/PDF, chọn chapter và đọc. Tiến độ, dấu trang, theme, cỡ chữ và player TTS được lưu theo user mặc định single-user.

Go API dùng Edge-TTS miễn phí với giọng `vi-VN-HoaiMyNeural` và `vi-VN-NamMinhNeural`; Edge-TTS cần Internet nhưng không cần API key. SaydiVoice nhận nhiều key qua `SAYDI_API_KEYS` (phân cách bằng dấu phẩy), vẫn hỗ trợ `SAYDI_API_KEY` cho cấu hình cũ, và tự xoay key khi quota, lỗi xác thực hoặc rate limit. MongoDB lưu audio đã tạo trong `audio_chunks`; TanStack Query giữ URL trong 24 giờ, còn player tải sẵn tối đa ba đoạn audio gần vị trí đang nghe. Âm lượng chỉ chỉnh lúc phát.

Khi có `SAYDI_API_KEYS`, player tự tải danh sách voice tiếng Việt từ Saydi để bạn chọn động. `SAYDI_VOICE_ID` và `SAYDI_VOICE_NAME` chỉ dùng làm voice dự phòng khi Saydi không trả danh sách.

Các API chính: `POST /api/books/upload`, `GET /api/books`, `GET /api/books/{bookId}/chapters/{chapterId}`, `GET|PUT /api/reader/progress/{bookId}`, `GET|POST|DELETE /api/reader/bookmarks/...`, `GET /api/tts/voices`, `GET /api/tts/chunks/{chapterId}`, `POST /api/tts/generate`, `GET /api/tts/audio/{audioChunkId}`.

Flyway tự chạy ba migration cho thư viện, tiến độ đọc, TTS cache và bookmark. Kiểm tra bằng `cd api; .\mvnw.cmd test` và `cd web; npm run lint; npm run build`.
