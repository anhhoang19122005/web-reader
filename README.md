# Novel Reader

## Bản Go dùng cho Vercel

### Bản cá nhân: web Vercel, API/Piper trên máy Windows

Web hiện ở `https://web-reader-six.vercel.app`. Trong PowerShell 7.4 trở lên,
chạy tại thư mục Reader sau khi máy khởi động lại:

```powershell
pwsh -File .\start-reader-home.ps1 -Publish
```

Script giữ nguyên thư viện/tiến độ Atlas và storage theo `.env`, chạy API riêng
ở port 8083, mở Cloudflare Quick Tunnel và cập nhật production env trên Vercel.
Máy phải bật và có Internet khi đọc. Quick Tunnel có URL tạm thời, đổi khi
khởi động lại; `-Publish` cập nhật địa chỉ mới và redeploy web. Để dùng hostname
ổn định lâu dài cần cấu hình named tunnel với domain riêng.

Tài khoản `reader` và mật khẩu tự tạo nằm trong `.reader-deploy/login.txt`.
Không commit hoặc chia sẻ `.reader-deploy/credentials.json`: nó chứa khóa API.
Khóa chỉ đặt phía server của Vercel, không có trong JavaScript frontend.
Đăng nhập Vercel CLI bằng `vercel login` nếu script yêu cầu. Lần đầu cần link
project: `cd web; vercel link --yes --project web-reader`.

Không cấu hình `READER_ACCESS_TOKEN` thì API local vẫn giữ hành vi cũ; chỉ
API dành cho tunnel mới bật bảo vệ token. Mật khẩu web dùng HTTP Basic qua HTTPS.

```powershell
.\start-reader-go.ps1
```

Lệnh này tự cài Go nếu thiếu, chạy migration MongoDB Atlas, Go API tại `http://localhost:8081/api` và web tại `http://localhost:3000`. Backend duy nhất nằm trong [`go-api`](go-api/README.md), dùng Edge-TTS trực tiếp bằng Go và thêm SaydiVoice khi có `SAYDI_API_KEYS`, cùng cấu hình deploy Vercel + Supabase.

Mở `http://localhost:3000/library` để upload EPUB/PDF, chọn chapter và đọc. Tiến độ, dấu trang, theme, cỡ chữ và player TTS được lưu theo user mặc định single-user.

Go API dùng Edge-TTS miễn phí với giọng `vi-VN-HoaiMyNeural` và `vi-VN-NamMinhNeural`; Edge-TTS cần Internet nhưng không cần API key. SaydiVoice nhận nhiều key qua `SAYDI_API_KEYS` (phân cách bằng dấu phẩy), vẫn hỗ trợ `SAYDI_API_KEY` cho cấu hình cũ, và tự xoay key khi quota, lỗi xác thực hoặc rate limit. MongoDB lưu audio đã tạo trong `audio_chunks`; TanStack Query giữ URL trong 24 giờ, còn player tải sẵn tối đa ba đoạn audio gần vị trí đang nghe. Âm lượng chỉ chỉnh lúc phát.

Khi có `SAYDI_API_KEYS`, player tự tải danh sách voice tiếng Việt từ Saydi để bạn chọn động. `SAYDI_VOICE_ID` và `SAYDI_VOICE_NAME` chỉ dùng làm voice dự phòng khi Saydi không trả danh sách.

Các API chính: `POST /api/books/upload`, `GET /api/books`, `GET /api/books/{bookId}/chapters/{chapterId}`, `GET|PUT /api/reader/progress/{bookId}`, `GET|POST|DELETE /api/reader/bookmarks/...`, `GET /api/tts/voices`, `GET /api/tts/chunks/{chapterId}`, `POST /api/tts/generate`, `GET /api/tts/audio/{audioChunkId}`.

Go API tự migration index MongoDB cho thư viện, tiến độ đọc, TTS cache và bookmark. Kiểm tra bằng `cd go-api; go test ./...` và `cd web; npm run lint; npm run build`.

### Âm nền miễn phí
Trong Reader, mở **Aa → Không gian đọc**, chọn một trong 8 âm: nhiễu nâu, trắng, hồng, quạt đều, mưa nhẹ, gió nhẹ, sóng biển hoặc suối chảy, rồi bấm **Bật âm nền**. Âm thiên nhiên là mô phỏng; mọi âm được tạo ngay trong trình duyệt, không cần key, tệp âm hoặc dịch vụ. Âm nền giảm tự động khi giọng đọc phát, tiếp tục qua chương, và reload luôn im lặng. Lựa chọn âm/âm lượng đồng bộ qua API tùy chỉnh; trạng thái bật chỉ giữ trong phiên.
