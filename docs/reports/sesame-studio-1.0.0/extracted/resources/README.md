# Sesame Studio

Bộ công cụ video AI **miễn phí** chạy trên Windows: tạo ảnh/video từ prompt, dựng prompt đồng bộ nhân vật và
bối cảnh, ghép và chỉnh sửa video theo dự án (Edit/Ghép), cắt video thành nhiều phần, đọc giọng (Text to Speech)
và đăng Reels.

Tác giả: Lan Phương Nguyễn · Giấy phép: miễn phí sử dụng, tác giả giữ bản quyền (xem `LICENSE.txt`).

## Cài đặt

1. Chạy `Sesame-Studio-Setup-<phiên bản>.exe`.
2. Windows có thể hiện cảnh báo vì bản cài chưa ký số: bấm **Thông tin thêm → Vẫn chạy** (chỉ làm khi bạn tải
   bản cài từ nguồn chính thức của tác giả).
3. Mở **Sesame Studio** từ Start Menu hoặc biểu tượng trên màn hình nền.

## Dùng được ngay, không cần tài khoản

Cắt video · Edit/Ghép · Thư viện · Prompt đồng bộ (FFmpeg đã kèm sẵn).

## Cần cài thêm tuỳ tính năng

| Tính năng | Cần |
|---|---|
| Tab Tài khoản (Muse, Google Flow, Dola, Seedance) | Google Chrome và tài khoản dịch vụ còn hạn mức |
| Giọng đọc nguồn Edge | Python 3 và `pip install edge-tts` |
| Giọng đọc nguồn VieNeu | Python 3.12 và gói `vieneu` |
| Giọng đọc nguồn Google | Chỉ cần Internet |
| Đăng Facebook Reels | Facebook token có quyền `pages_manage_posts`, `publish_video` |

## Video và dự án lưu ở đâu

* Video xuất ra: `Videos\Sesame Studio` (đổi trong tab **Cài đặt**).
* Dự án Edit/Ghép, tài khoản, nhật ký: `%APPDATA%\Sesame Studio`.
* File video gốc của bạn không bị sửa hay xoá.

## Hướng dẫn

Xem tab **Hướng dẫn** trong ứng dụng: mỗi mục ghi rõ mức đã kiểm (✅ đã chạy thử thật, 🧪 beta, ⚠ giới hạn).

## Thành phần bên thứ ba

Xem `THIRD_PARTY_NOTICES.md`.
