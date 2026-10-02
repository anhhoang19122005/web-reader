---
name: Gác Sách
description: Không gian đọc thiên nhiên với giọng kể và âm nền tùy chọn.
colors:
  primary: "#3e593e"
  background: "#f4efe7"
  surface: "#fbf8f2"
  ink: "#242b24"
  muted: "#596353"
  line: "#d5d8c9"
  highlight: "#e1e8d7"
typography:
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "1rem"
    lineHeight: 1.6
    letterSpacing: "normal"
  display:
    fontFamily: "Georgia, Times New Roman, serif"
    fontSize: "2.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
rounded:
  control: "8px"
  panel: "12px"
spacing:
  small: "8px"
  medium: "16px"
  large: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    rounded: "{rounded.control}"
---

## Overview
Một góc đọc yên, xanh rêu làm điểm nhấn. Bảy chế độ Sáng/Giấy/Tối/Rừng/Biển/Anh đào/Hoàng hôn dùng chung token CSS; màu chọn theo sở thích người đọc, không theo màn hình.

## Colors
Token thực thi nằm trong globals.css. Sáng: nền #f5f7f3, surface trắng, accent #365b40. Tối: nền #151d18, surface #1d2921, chữ #e5ebdf, accent #b4cf9a. Highlight dùng accent-soft riêng mỗi theme. Rừng: nền #18251e, accent #b1d099. Biển: nền #edf4f7, accent #245f76. Anh đào: nền #faf0f3, accent #8f4564. Hoàng hôn: nền #292126, accent #edb294. Lá rơi đổi màu nhẹ theo palette. Nhãn theme và ô màu giúp phân biệt bằng cả chữ lẫn màu.

## Typography
Georgia dành cho thương hiệu, tiêu đề sách và trang. Arial cho nội dung đọc, nút và nhãn; word-spacing và letter-spacing normal. Cỡ đọc 16–28px (mặc định 20px), giãn dòng 1.5–2.2 (mặc định 1.8), Sans Arial hoặc Serif Source Serif 4 (tự host bằng next/font/local). Cột đọc 60/68/75ch (mặc định 68ch), giới hạn theo màn hình. Giữ offset UTF-16 khi đổi bố cục; dữ liệu Nhỏ/Vừa/Lớn cũ chuyển thành 18/20/24px.

## Layout
Header 64px; Reader ghim player ngay dưới header, thu thành một hàng khi chưa phát. Thư viện dùng lưới bìa trên desktop, hàng sách trên mobile và khối Đọc tiếp có tên chương. Chi tiết sách đặt Đọc tiếp trước mục lục. Mobile gộp cài đặt về một cột, có thanh hành động ở cạnh dưới. Mục lục dùng native dialog, tìm tên chương không phân biệt dấu. Chế độ tập trung ẩn giao diện nhưng giữ audio node, có nút thoát/dừng riêng. Thanh tiến độ chương ở cạnh trên; thời gian đọc chữ ước lượng 200 từ/phút.

## Components
Nút chính xanh rêu, focus có outline. Panel một border, không lồng card. Giọng đọc dùng details/summary; mobile mở phần điều chỉnh thành sheet. Nút Aa mở native popover cho chữ, theme và âm nền. Giữ audio controls để tua và tạm dừng. Tùy chỉnh đồng bộ từng trường qua API, có queue localStorage khi offline; trạng thái phát/tập trung không đồng bộ. Phím F/T/D và ←/→ chỉ hoạt động ngoài vùng điều khiển/nhập liệu. Loading, lỗi và empty state dùng cùng palette.

## Motion
Transition 180ms cho trạng thái điều khiển. Một lá rơi CSS mỗi 12–25 giây, kéo dài 10 giây, ở mép màn hình và không nhận tương tác. Tắt trên reduced motion, tạm dừng khi tab ẩn. Âm nền mặc định tắt, gain 0–30%; duck xuống 30% trong 250ms và phục hồi trong 800ms. Không thêm thư viện motion hoặc tải âm thanh ngoài.

## Điều hướng và dữ liệu offline
Dấu trang của cả sách nằm trong drawer cùng mục lục, có trích đoạn và tên chương; bấm để nhảy theo UTF-16, không ghi tiến độ từ thao tác khôi phục. Dùng SVG cùng nét cho icon. Tập trung chỉ bật bằng nút/F, tránh chạm nhầm khi chọn chữ; gợi ý hiện một lần. Theme đặt ngay trong head trước hydration, cập nhật màu thanh trình duyệt theo theme.

Upload nhận nhiều tệp bằng chọn/kéo thả, xử lý tuần tự và báo từng tệp qua các bước tải lên, tách chương, hoàn tất/lỗi. Xóa sách dùng toast hoàn tác 15 giây; API giữ mốc xóa 30 giây trước khi dọn. Dọn thất bại giữ document để thử lại, không chặn thư viện.

PWA dùng manifest, service worker và CacheStorage của trình duyệt, không thêm thư viện. Chỉ cache nội dung GET thành công, tối đa 40 mục sách/chương/bìa; không cache request tạo TTS, secret hoặc trạng thái phát. Offline shell được làm mới khi mở app; dữ liệu chương giữ qua phiên. Trang Sách offline cho đọc lại, xóa cache và ghi tiến độ vào queue local để gửi khi online, backend vẫn giữ mốc xa nhất. Offline không tổng hợp giọng đọc. Cache tồn tại riêng trên từng thiết bị.

Định dạng EPUB vẫn dùng plainText làm nguồn offset. Khi cần khôi phục in đậm/nghiêng/ảnh, thêm các span định dạng theo [start,end,kiểu]; không chuyển Reader sang HTML làm lệch vị trí TTS.
