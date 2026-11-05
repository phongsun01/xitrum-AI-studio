# 🚀 Xitrum AI Studio

> **Hệ thống tạo video & audio hàng loạt siêu nhẹ dành cho máy tính để bàn (Windows)**  
> Được xây dựng trên nền tảng **Tauri v2 + Rust + React/TypeScript**.

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

- **Backend**: Rust, Tauri v2, Tokio, Rusqlite, ONNX Runtime (`ort`), `image` crate.
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
```bash
# Cài đặt frontend dependencies
npm install

# Khởi động ứng dụng Tauri Dev
npm run tauri dev
```

### Đóng gói bản cài đặt Release:
```bash
npm run tauri build
```
File cài đặt sẽ được tạo tại `src-tauri/target/release/bundle/nsis/`.

---

## 📄 Bản Quyền
Dự án phát triển cho mục đích cá nhân và nghiên cứu công nghệ.
