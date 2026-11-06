# 🚀 Xitrum AI Studio

> **Hệ thống tạo video & audio tự động hóa đa luồng siêu nhẹ dành cho Windows**  
> Được xây dựng trên nền tảng **Tauri v2 + Rust + React/TypeScript**.

---

## 📦 Phiên Bản Hiện Tại: v0.4.0

### Tính năng mới v0.4.0 (Automation Engine & Multi-Lane Production):
- 🤖 **Runner Muse.ai Playwright CDP Tự Động (F11)**: Tự động đăng nhập, gửi prompt, tải ảnh tham chiếu và download video hoàn thành từ Muse.ai thông qua profile Chrome thật của người dùng.
- 📐 **Menu Thu Gọn / Mở Rộng Linh Hoạt**: Tối ưu không gian làm việc với nút toggle sidebar phong cách ChatGPT.
- 🎬 **Tự Động Render Nối Video FFmpeg (F12)**: Tự động gom toàn bộ video clips từ các segment đã hoàn thành, ghép nối theo đúng thứ tự thời gian và chèn lại track giọng nói gốc đồng bộ.
- 🎵 **Trộn Nhạc Nền Tự Động (F13)**: Tự động quét thư mục nhạc nền, loop/cắt khớp độ dài video, hạ âm lượng thông minh (ducking/volume slider) để làm nổi bật giọng thuyết minh.
- 🚦 **Hàng Đợi Đa Luồng Độc Lập - Multi-Lane Semaphore (F14)**: Tách riêng luồng xử lý Muse.ai (giới hạn 1 tác vụ để tránh checkpoint) và luồng xử lý Local (Rembg/FFmpeg chạy song song), hiển thị trạng thái realtime trên thanh tiêu đề.
- 🔄 **Tạo Lại Đoạn Đơn Lẻ (F15)**: Cho phép tạo lại video cho riêng từng câu thoại/segment không ưng ý mà không cần dựng lại cả kịch bản.

---

## ✨ Điểm Nổi Bật

- **Tái hiện trọn vẹn Workflow Audio → Video AI của Kahi**:
  - Nhập file âm thanh thu âm bất kỳ.
  - Phân tích và biên tập câu chữ trên Audio Timeline.
  - Ghép hình người mẫu đã xóa phông nền (Rembg ONNX).
  - Tự động sinh video qua Muse.ai và render video hoàn chỉnh kèm nhạc nền.
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
- [x] **v0.4.0**: Runner Muse.ai tự động hoàn chỉnh, Tự động ghép video + nhạc nền, Multi-lane runner đa luồng, Tái sinh segment đơn lẻ.

---

## 📄 Bản Quyền
Dự án phát triển cho mục đích cá nhân và nghiên cứu công nghệ.
