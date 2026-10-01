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
Georgia dành cho thương hiệu, tiêu đề sách và trang. Arial cho nội dung đọc, nút và nhãn; word-spacing và letter-spacing normal. Cỡ đọc 18/20/24px, line-height 32/36/40px. Cột Reader tối đa 760px gồm padding.

## Layout
Header 64px; Reader ghim player ngay dưới header. Thư viện dùng các hàng sách và mục đọc gần đây. Chi tiết sách đặt Đọc tiếp trước mục lục. Mobile gộp cài đặt về một cột.

## Components
Nút chính xanh rêu, focus có outline. Panel một border, không lồng card. Cài đặt dùng details/summary bàn phím nguyên bản. Giữ audio controls để tua và tạm dừng. Loading, lỗi và empty state dùng cùng palette.

## Motion
Transition 180ms cho trạng thái điều khiển. Một lá rơi CSS mỗi 12–25 giây, kéo dài 10 giây, ở mép màn hình và không nhận tương tác. Tắt trên reduced motion, tạm dừng khi tab ẩn. Âm nền mặc định tắt, gain 0–30%; duck xuống 30% trong 250ms và phục hồi trong 800ms. Không thêm thư viện motion hoặc tải âm thanh ngoài.
