# Nhật Ký Lỗi & Giải Pháp Xử Lý (Bug & Fix Log)

> **Dự án**: Xitrum AI Studio (Porting Kahi AI sang Tauri v2 + Rust)  
> **Thư mục dự án**: `D:\Antigravity\REA\project-docs\my-kahi-tauri`  
> **Cập nhật ngày**: 2026-11-05

---

## 1. Lỗi: Panic "there is no reactor running, must be called from the context of a Tokio 1.x runtime"

- **Thời điểm**: Giai đoạn 2 (Khởi chạy ứng dụng lần đầu với Actor Queue).
- **Hiện tượng**:
  Khi chạy `npm run tauri dev`, ứng dụng bị crash ngay khi khởi động với thông báo:
  ```text
  thread 'main' panicked at src\queue.rs:30:9:
  there is no reactor running, must be called from the context of a Tokio 1.x runtime
  ```
- **Nguyên nhân gốc rễ**:
  Trong Tauri v2, hàm `main()` mặc định là hàm đồng bộ bình thường. Lời gọi `QueueManager::new()` bên trong khởi tạo chứa lệnh `tokio::spawn(async move { ... })`. Khi đó, Tokio reactor chưa được kích hoạt trên Main Thread nên Tokio từ chối spawn task ngầm.
- **Phương án khắc phục**:
  Thêm attribute macro `#[tokio::main]` cho hàm `main()` tại `src-tauri/src/main.rs`:
  ```rust
  #[tokio::main]
  async fn main() {
      xitrum_ai_studio_lib::run()
  }
  ```
  Nhờ đó, toàn bộ ứng dụng chạy bên trong Tokio 1.x multi-threaded runtime ngay từ đầu.

---

## 2. Lỗi: Ứng dụng chớp tắt khởi động lại liên tục 3 lần khi bấm thêm task (Tauri Dev Loop Restart)

- **Thời điểm**: Giai đoạn 3 (Khi người dùng bấm thêm task bóc tách audio hoặc tạo video).
- **Hiện tượng**:
  Mỗi khi bấm nút thêm task, giao diện chớp tắt liên tục 3-4 lần, tiến độ chỉ dừng ở 10% rồi mất kết nối. Dòng log terminal hiện:
  ```text
  Info File src-tauri\xitrum_ai.db changed. Rebuilding application...
  ```
- **Nguyên nhân gốc rễ**:
  Khi chạy chế độ phát triển `npm run tauri dev`, Tauri có trình theo dõi tệp (**File Watcher**) giám sát toàn bộ thư mục `src-tauri/`. Ban đầu, file SQLite `xitrum_ai.db` được tạo trực tiếp bên trong `src-tauri/`. Khi người dùng thêm task, dữ liệu được ghi vào `xitrum_ai.db`, làm timestamp của file thay đổi -> File Watcher hiểu nhầm là lập trình viên vừa sửa code Rust nên tự động **kill process và rebuild/restart app ngay lập tức**.
- **Phương án khắc phục**:
  Chuyển đường dẫn lưu file database ra ngoài thư mục mã nguồn, đưa vào thư mục `%TEMP%` (hoặc `AppData` của người dùng):
  ```rust
  let temp_dir = std::env::temp_dir();
  let db_path = temp_dir.join("xitrum_ai.db");
  ```
  File Watcher không còn bị kích hoạt nhầm khi DB ghi dữ liệu, ứng dụng chạy ổn định tuyệt đối.

---

## 3. Lỗi: Không có cơ chế ghi log để điều tra lỗi ngầm (Missing Tracing Log)

- **Hiện tượng**:
  Khi các tiến trình con bên ngoài (Sidecar FFmpeg, Whisper-cli hoặc ONNX Runtime) gặp lỗi hoặc crash, giao diện không hiển thị chi tiết nguyên nhân, không có file log để tra cứu.
- **Phương án khắc phục**:
  1. Cấu hình thư viện `tracing` và `tracing_appender` trong `src/lib.rs` ghi song song ra cả **Console Terminal** và file log cố định:
     `%TEMP%\xitrum_debug.log`
  2. Bắt toàn bộ luồng `stderr` từ FFmpeg và Whisper-cli; nếu tiến trình con thoát với exit code khác 0, ghi toàn bộ stderr vào log và đẩy thông báo lỗi cụ thể lên cột "File Đầu Ra / Lỗi" của giao diện người dùng.

---

## 4. Lỗi: Whisper.cpp lỗi không mở được file có dấu tiếng Việt trên Windows CLI

- **Thời điểm**: PoC 0.4.
- **Hiện tượng**:
  Khi truyền đường dẫn chứa ký tự tiếng Việt có dấu (ví dụ: `D:\Thư Mục Test\bài hát.mp3`), `whisper-cli.exe` báo lỗi:
  ```text
  error: input file not found: no input files specified
  ```
- **Nguyên nhân gốc rễ**:
  `whisper-cli` viết bằng C/C++ dùng hàm chuẩn C runtime (`fopen`), trên Windows không tự động giải mã chuỗi UTF-8 đa byte từ command line arguments.
- **Phương án khắc phục**:
  Xây dựng **Pipeline 2 bước**:
  1. Dùng `ffmpeg` (hỗ trợ Unicode UTF-8 tốt) đọc file gốc tiếng Việt và xuất ra file WAV tạm trong thư mục `%TEMP%` với tên chuẩn ASCII (ví dụ: `xitrum_audio_uuid.wav`).
  2. Truyền file WAV tạm này cho `whisper-cli.exe` xử lý bóc tách sang JSON timeline.
  3. Sau khi Whisper xử lý xong, hệ thống tự động xóa file WAV tạm để dọn dẹp dung lượng đĩa.

