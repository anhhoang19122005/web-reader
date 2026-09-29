# Novel Reader

```powershell
.\start-reader.ps1
```

Lệnh trên khởi động PostgreSQL, tự cài `edge-tts` nếu thiếu và mở API, web trong hai cửa sổ PowerShell riêng.

API health: `http://localhost:8080/api/health`

Mở `http://localhost:3000/library` để upload EPUB/PDF, chọn chapter và đọc. Tiến độ, dấu trang, theme, cỡ chữ và player TTS được lưu theo user mặc định single-user.

TTS ưu tiên Edge-TTS miễn phí qua Python với giọng `vi-VN-HoaiMyNeural` và `vi-VN-NamMinhNeural`; Edge-TTS cần Internet nhưng không cần API key. Nếu Edge-TTS không khả dụng, SaydiVoice dùng `SAYDI_API_KEY`, FPT.AI dùng `FPT_AI_API_KEY`, Azure Speech dùng `AZURE_SPEECH_KEY` và `AZURE_SPEECH_REGION`; cuối cùng là `vi-mock-narrator`. Các chunk audio được cache theo chapter, voice và thông số đọc trong `audio_chunks`.

Các API chính: `POST /api/books/upload`, `GET /api/books`, `GET /api/books/{bookId}/chapters/{chapterId}`, `GET|PUT /api/reader/progress/{bookId}`, `GET|POST|DELETE /api/reader/bookmarks/...`, `GET /api/tts/voices`, `GET /api/tts/chunks/{chapterId}`, `POST /api/tts/generate`, `GET /api/tts/audio/{audioChunkId}`.

Flyway tự chạy ba migration cho thư viện, tiến độ đọc, TTS cache và bookmark. Kiểm tra bằng `cd api; .\mvnw.cmd test` và `cd web; npm run lint; npm run build`.
