# 🚀 Xitrum AI Studio

> **Hệ thống tạo video & audio tự động hóa đa luồng siêu nhẹ dành cho Windows**  
> Được xây dựng trên nền tảng **Tauri v2 + Rust + React/TypeScript**.

---

## 📦 Phiên Bản Hiện Tại: v0.2.0

### Tính năng mới v0.2.0:
- 📂 **Mở Thư Mục Kết Quả (F1)**: Nút 1-click mở trực tiếp folder chứa sản phẩm xuất ra trên Windows Explorer.
- 🔄 **Retry Task Thất Bại (F2)**: Đưa lại task lỗi vào hàng đợi ngay lập tức mà không cần tạo lại.
- 📋 **Nhân Bản Task (F3)**: Sao chép nhanh prompt và thông số từ task có sẵn.
- ✏️ **Sửa Prompt Tại Chỗ (F4)**: Chỉnh sửa trực tiếp prompt của các task đang chờ (`queued`) trên bảng.
- 🔔 **Toast Notification System (F5)**: Hệ thống thông báo nổi góc màn hình mượt mà, phản hồi lập tức các thao tác.
- 📚 **Thư Viện Templates & Presets (F6)**: Tab quản lý và lưu trữ các prompt kèm tỉ lệ khung hình để tái sử dụng chỉ với 1 click "Áp Dụng".

---

## ✨ Điểm Nổi Bật

- **Siêu Nhẹ & Tiết Kiệm Tài Nguyên**:
  - Dung lượng cài đặt chỉ **~41 MB** (thay vì >250 MB như Electron).
  - Tiêu tốn chỉ **~40 - 60 MB RAM** khi chạy ngầm.
- **Tự Động Hóa Muse.ai**:
  - Kết nối trực tiếp vào Google Chrome profile thật qua CDP.
  - Lưu phiên đăng nhập vĩnh viễn, tránh bot detection.
- **Xử Lý Âm Thanh Nhanh Chóng**:
  - Tích hợp pipeline `FFmpeg` chuẩn hóa audio sang WAV 16kHz.
  - Tích hợp `whisper-cli.exe` bóc tách giọng nói sang timeline JSON chính xác từng câu chữ.
- **Tách Nền Ảnh Siêu Tốc (Rembg)**:
  - Tích hợp **ONNX Runtime Rust** (`ort`) cùng mô hình `u2netp.onnx`.
  - Xóa phông ảnh chân dung chỉ mất **~0.2 giây / ảnh**, không leak memory.
- **Hàng Đợi Bền Vững (Task Queue)**:
  - Lưu trạng thái tác vụ vào **SQLite**.
  - Tự động khôi phục hàng đợi khi app khởi động lại.
  - Hỗ trợ nút **Hủy (Cancel)** lập tức qua `CancellationToken`.

---

## 🛠️ Công Nghệ Sử Dụng

- **Backend**: Rust, Tauri v2, Tokio, Rusqlite, ONNX Runtime (`ort`), `opener`, `image` crate.
- **Frontend**: React 19, TypeScript, Vite, `lucide-react`.
- **RPA Engine**: Playwright Core kết nối Chrome CDP.
- **Media Engine**: FFmpeg & Whisper.cpp portable sidecars.

---

## 💻 Hướng Dẫn Cài Đặt & Phát Triển

### Yêu cầu:
- Windows 10 / 11 64-bit
- Node.js >= 20
- Rust toolchain (`rustup`)
- Microsoft C++ Build Tools 2022

### Chạy chế độ phát triển:
```powershell
# Cài đặt frontend dependencies
npm install

# Khởi động ứng dụng Tauri Dev
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri dev
```

### Đóng gói bản cài đặt Release:
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri build
```
File cài đặt sẽ được tạo tại `src-tauri/target/release/bundle/nsis/`.

---

## 🗺️ Lộ Trình Phát Triển (Roadmap)
- [x] **v0.1.0**: Lõi hàng đợi SQLite, Rembg ONNX native, FFmpeg & Whisper STT.
- [x] **v0.2.0**: Mở folder kết quả, Retry, Duplicate, Edit prompt, Toast notification, Thư viện Templates.
- [ ] **v0.3.0**: Audio Timeline Segment Editor, Xuất phụ đề (SRT/TXT), Bộ chọn mô hình Whisper (Tiny/Base/Medium), Duyệt ảnh/video (Approve/Reject).
- [ ] **v0.4.0**: Runner Muse.ai tự động hoàn chỉnh, Tự động ghép video + nhạc nền, Multi-lane runner đa luồng.

---

## 📄 Bản Quyền
Dự án phát triển cho mục đích cá nhân và nghiên cứu công nghệ.
