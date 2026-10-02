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
để ẩn giọng local trong cấu hình Vercel Functions hiện tại. Khi deploy Docker,
giữ `PIPER_ENABLED=true` và xem hướng dẫn bên dưới.

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

### Thiền Tâm Đức — VieNeu local

Đặt checkout VieNeu-TTS và môi trường Python đã cài tại `test/VieNeu-TTS`.
`start-reader-vieneu.ps1` dùng API có sẵn `apps.openai_speech`, chỉ lắng nghe
`127.0.0.1:8000`, chạy ONNX int8 trên CPU và giữ model trong RAM.
Hai script Reader gọi helper này khi tìm thấy `.venv/Scripts/python.exe`.
Đặt `VIENEU_ENABLED=false` nếu muốn bỏ qua hoặc cấu hình Go API thủ công:

```text
VIENEU_API_URL=http://127.0.0.1:8000/v1
```

Giọng xuất hiện trong provider `VieNeu · Local`. Preset nguồn có tên chính xác
`Thiền Tâm Đức`. API v3 hiện bỏ qua tốc độ tổng hợp/cao độ, nên player khóa hai
thông số này; dùng `Tốc độ phát lại` để nghe nhanh/chậm. Cache, đọc liên tục và
lưu tiến độ vẫn dùng luồng Reader hiện có. Không commit checkout hay model.

Khi cập nhật API đang chạy bằng script home:

```powershell
pwsh -File .\start-reader-home.ps1 -Restart -Publish
```

`-Restart` chỉ dừng binary API được script quản lý và kiểm tra đúng path/PID.
Container Piper không tự chứa VieNeu; cần chạy dịch vụ VieNeu riêng và đặt URL.

Thử tổng hợp riêng, không sửa tiến độ sách:

```powershell
cd go-api
$env:VIENEU_INTEGRATION_URL='http://127.0.0.1:8000/v1'
go test -run TestVieNeuLocalIntegration -v
```

### Deploy có giọng Piper

Đặt web trên Vercel, còn Go API chạy Docker Linux amd64 trên máy chủ hỗ trợ
container. Dockerfile cài Piper và tải hai model giống bản Windows lúc build;
không cần commit model hay dùng API key TTS. Audio được tạo trên máy chủ và
trả về trình duyệt; điện thoại không cần cài Piper.

Build từ thư mục repo:

```powershell
docker build --platform linux/amd64 -t reader-api-piper ./go-api
```

Thiết lập biến môi trường trên máy chủ:

```text
MONGODB_URI=<cùng Atlas URI đang dùng>
MONGODB_DATABASE=novel_reader
AUTO_MIGRATE=true
STORAGE_PROVIDER=supabase
SUPABASE_URL=<Supabase URL>
SUPABASE_SERVICE_ROLE_KEY=<server-only-key>
SUPABASE_STORAGE_BUCKET=reader
CORS_ALLOWED_ORIGINS=https://<web-project>.vercel.app
PIPER_ENABLED=true
```

Giữ các đường dẫn `PIPER_*` mặc định của image; không đưa đường dẫn Windows
từ `.env` local vào container. Máy chủ có thể đặt `PORT` theo yêu cầu nền tảng.
Web đặt `NEXT_PUBLIC_API_BASE_URL=https://<container-api>/api` rồi redeploy.
MongoDB lưu tiến độ, Supabase lưu sách/audio bền vững sau khi container restart.
Khuyến nghị khởi đầu 2 CPU, 2 GB RAM rồi đo thời gian tạo audio thực tế.
Giọng Piper không tốn phí API; máy chủ chạy model vẫn có thể phát sinh chi phí.
Kiểm tra điều khoản model trước khi phân phối hoặc dùng thương mại.

Kiểm tra Piper trong image, không cần database:

```powershell
docker run --rm --entrypoint sh reader-api-piper -c 'printf "Xin chào, đây là giọng đọc tiếng Việt." | /opt/piper/piper --model /opt/piper/voices/duy_oryx.onnx --config /opt/piper/voices/duy_oryx.onnx.json --espeak_data /opt/piper/espeak-ng-data --output_file /tmp/test.wav && test -s /tmp/test.wav'
```

Trước khi mở API công khai, cần bổ sung xác thực vì bản hiện tại dùng một
user cố định cho thư viện và tiến độ.

### Deploy Go API bằng Vercel Functions

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

## Tùy chỉnh Reader và vị trí đọc

- `GET /api/reader/preferences`: trả `{ preferences: null, updatedAt: null }` khi chưa lưu, hoặc object tùy chỉnh của người dùng cá nhân hiện tại.
- `PATCH /api/reader/preferences`: gửi chỉ các trường thay đổi. Hỗ trợ `theme` (7 theme), `font` (`sans`/`serif`), `fontSize` (16–28, số nguyên), `lineHeight` (1.5–2.2, bước 0.1), `columnWidth` (60/68/75), `leaves` (boolean), `sound` (`brown`/`rain`), `ambientVolume` (0–0.3). Không nhận trường lạ hoặc trạng thái phát.
- MongoDB dùng collection `reading_preferences`, `_id` là ID người dùng cố định hiện có; không cần migration/index mới. PATCH `$set` từng trường và `updatedAt`, không thay thế cả document.
- Web dùng localStorage ngay, debounce PATCH 500ms, giữ trường chưa gửi được trong `pending`, thử lại khi trở lại tab/có kết nối và sau lỗi. Cấu hình server chỉ thay các trường local không có thay đổi đang chờ. Khi chưa có bản server, đưa bản local lên một lần.
- Tiến độ/bookmark giữ nguyên UTF-16 `characterPosition` và schema hiện có. Cuộn tay đo vị trí qua DOM Range; khôi phục/đổi font/resize/cuộn TTS không tự ghi vị trí cuộn. Backend tiếp tục giữ mốc xa nhất.
- Reader chỉ prefetch GET nội dung chương sau ở 70% hoặc đoạn TTS cuối; không tự tạo audio chương chưa nghe.
- Phím tắt: F tập trung, T mục lục, D đổi theme, ←/→ đổi chương, Esc thoát tập trung/mục lục. Phím tắt bỏ qua vùng nhập liệu và audio.

Kiểm tra trong trình duyệt (toàn bộ API mock, không ghi dữ liệu thật):

```powershell
playwright-cli open about:blank
playwright-cli run-code --filename web/tests/reader-upgrades.js
```

`READER_INTEGRATION_TEST=true go test ./...` kiểm tra MongoDB bằng sách UUID thử riêng và database tùy chỉnh `rpt_<UUID>` riêng, tự dọn dữ liệu thử. Không sửa tùy chỉnh hoặc tiến độ sách thật. Sau cập nhật backend dùng `pwsh -File .\start-reader-home.ps1 -Restart -Publish` để khởi động lại API quản lý và cập nhật web.
