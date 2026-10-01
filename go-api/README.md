# Novel Reader Go API

Backend Go thay Spring Boot cho phần triển khai mới. API dùng MongoDB Atlas, Supabase Storage khi deploy và Edge-TTS qua Go nên không cần Python.

## Chạy local

Tạo file `.env` ở thư mục `Reader` và thêm:

```text
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DATABASE=novel_reader
STORAGE_PROVIDER=local
EDGE_TTS_ENABLED=true
SAYDI_API_KEYS=<saydi-key-1>,<saydi-key-2>
# SAYDI_API_KEY=<legacy-single-saydi-key>
SAYDI_VOICE_ID=vi-adam
SAYDI_VOICE_NAME=Adam · SaydiVoice
CORS_ALLOWED_ORIGINS=http://localhost:3000
```

Khi có `SAYDI_API_KEYS`, API tự lấy danh sách voice tiếng Việt từ Saydi và giao diện cho chọn động. Key chỉ nằm ở backend, dùng theo thứ tự cấu hình và tự xoay khi gặp quota, lỗi xác thực hoặc rate limit; lỗi 5xx retry cùng key. `SAYDI_API_KEY` vẫn được hỗ trợ cho một key. Hai biến `SAYDI_VOICE_ID`/`SAYDI_VOICE_NAME` chỉ là voice dự phòng nếu Saydi không trả danh sách.

## Giọng local offline (Piper, miễn phí 100%)

`start-reader-go.ps1` tự tải `piper.exe` (Windows), 2 model Việt (~63MB/giọng) và
`espeak-ng-data` vào `tools/piper/` khi chạy lần đầu:

- **Duy Siêu Trầm** (`local-duyoryx-sieutram`): nam siêu trầm, uy nghiêm quyền lực, kiểu Tào Tháo — mặc định khi có local.
- **Ngọc Ngạn** (`local-ngocngan-kechuyen`): nam trầm ấm kể chuyện.

Edge/Saydi/mock giữ nguyên. Giọng local không hỗ trợ cao độ (chuẩn hóa `pitch=0`,
volume xử lý ở player) và map `speakingRate` sang `length_scale` của Piper.
Preset **Tào Tháo** (`0.85x`) trên web hợp nhất với Duy Siêu Trầm.
Model cộng đồng từ dataset `lamyaya88a/tts-ngochuyen-v1` (HuggingFace), kiểm tra
lại điều khoản trước khi dùng thương mại. Deploy Vercel đặt `PIPER_ENABLED=false`
để ẩn giọng local (serverless không chạy Piper).

Sau đó chạy tại thư mục `Reader`:

```powershell
.\start-reader-go.ps1
```

Script tự cài Go bằng `winget` nếu máy chưa có, chạy index migration và mở Go API ở `http://localhost:8081/api` cùng web ở `http://localhost:3000`.

Chạy thủ công:

```powershell
cd go-api
$env:MONGODB_URI = "mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority"
$env:MONGODB_DATABASE = "novel_reader"
$env:AUTO_MIGRATE = "true"
go run ./cmd/local
```

API health: `http://localhost:8081/api/health`.

## MongoDB Atlas

Tạo một Free cluster, database user và cấu hình Atlas Network Access. Khi chạy local, cho phép IP hiện tại; Vercel Hobby dùng dải IP outbound động nên không thể allowlist một IP nhà cố định. Nếu cần IP tĩnh, Vercel cung cấp Static IPs cho Pro+. Lấy connection string ở **Connect → Drivers → Go** rồi đặt vào `MONGODB_URI`. MongoDB Go Driver dùng một `MongoClient` dùng lại cho connection pool; backend khởi tạo client một lần cho mỗi instance API.

Chạy index migration một lần nếu không dùng `AUTO_MIGRATE`:

```powershell
cd go-api
$env:MONGODB_URI = "mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority"
$env:MONGODB_DATABASE = "novel_reader"
go run ./cmd/migrate
```

Dữ liệu được lưu trong các collection `books`, `chapters`, `reading_progress`, `bookmarks` và `audio_chunks`. Chapter nằm riêng để không vượt giới hạn 16 MiB của một BSON document.

## Deploy Vercel

Tạo hai Vercel projects từ cùng GitHub repo:

1. API project: Root Directory `go-api`.
2. Web project: Root Directory `web`.

Biến môi trường API project:

```text
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DATABASE=novel_reader
STORAGE_PROVIDER=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only-key>
SUPABASE_STORAGE_BUCKET=reader
EDGE_TTS_ENABLED=true
SAYDI_API_KEYS=<saydi-key-1>,<saydi-key-2>
# SAYDI_API_KEY=<legacy-single-saydi-key>
SAYDI_VOICE_ID=vi-adam
SAYDI_VOICE_NAME=Adam · SaydiVoice
PIPER_ENABLED=false
CORS_ALLOWED_ORIGINS=https://<web-project>.vercel.app
```

Biến môi trường Web project:

```text
NEXT_PUBLIC_API_BASE_URL=https://<api-project>.vercel.app/api
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable-or-anon-key>
```

`SUPABASE_SERVICE_ROLE_KEY` chỉ đặt ở API project. Web chỉ dùng key publishable/anon để upload qua signed URL ngắn hạn do API tạo.

Backend Spring và PostgreSQL cũ vẫn nằm trong thư mục `api/`; chúng chỉ được dùng khi chạy `start-reader.ps1`.
