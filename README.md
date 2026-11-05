# 🚀 Xitrum AI Studio

> **Hệ thống tạo video & audio tự động hóa đa luồng siêu nhẹ dành cho Windows**  
> Được xây dựng trên nền tảng **Tauri v2 + Rust + React/TypeScript**.

---

## 📦 Phiên Bản Hiện Tại: v0.3.0

### Tính năng mới v0.3.0 (Audio Pipeline & Timeline Editor):
- 🎙️ **Audio Timeline Segment Editor (F7)**: Bóc tách giọng nói tự động phân rã thành từng câu, cho phép nghe, chỉnh sửa câu chữ, gán prompt AI và ảnh người mẫu tham chiếu trực tiếp trên giao diện Timeline.
- 📤 **Đẩy Trực Tiếp Sang Hàng Đợi Queue (F7)**: Nút "Tạo Video" cho từng segment giúp tạo task sinh video Muse.ai tức thì theo đúng timestamp và hình ảnh đã chọn.
- 💾 **Xuất Phụ Đề & Kịch Bản (F8)**: Xuất kịch bản ra định dạng `.srt` chuẩn mili-giây hoặc file `.txt`.
- ⚙️ **Bộ Chọn Mô Hình Whisper (F9)**: Tùy chọn chuyển đổi linh hoạt giữa các model `ggml-tiny` (nhanh), `ggml-base` (cân bằng), `ggml-medium` (chuẩn xác cao).
- 👍 **Duyệt Kết Quả Segment (F10)**: Tính năng duyệt/bỏ qua (Approve / Reject) từng câu thoại trước khi render.

---

## ✨ Điểm Nổi Bật

- **Tái hiện trọn vẹn Workflow Audio → Video AI của Kahi**:
  - Nhập file âm thanh thu âm bất kỳ.
  - Phân tích và biên tập câu chữ trên Audio Timeline.
  - Ghép hình người mẫu đã xóa phông nền (Rembg ONNX).
  - Tự động sinh video qua Muse.ai.
- **Siêu Nhẹ & Tiết Kiệm Tài Nguyên**:
  - Dung lượng cài đặt chỉ **~41 MB** (thay vì >250 MB như Electron).
  - Tiêu tốn chỉ **~40 - 60 MB RAM** khi chạy ngầm.
- **Hàng Đợi Bền Vững (Task Queue)**:
  - Lưu trạng thái tác vụ vào **SQLite**.
  - Tự động khôi phục hàng đợi khi app khởi động lại.
  - Hỗ trợ hủy tác vụ tức thì qua `CancellationToken`.

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
- [x] **v0.3.0**: Audio Timeline Segment Editor, Xuất phụ đề (.SRT/.TXT), Chọn mô hình Whisper, Duyệt câu thoại (Approve/Reject).
- [ ] **v0.4.0**: Runner Muse.ai tự động hoàn chỉnh, Tự động ghép video + nhạc nền, Multi-lane runner đa luồng.

---

## 📄 Bản Quyền
Dự án phát triển cho mục đích cá nhân và nghiên cứu công nghệ.
