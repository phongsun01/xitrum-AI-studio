# Hướng Dẫn Porting & Vận Hành Trên macOS (Apple Silicon & Intel)

> **Tài liệu phân tích khả năng tương thích và hướng dẫn chuyển đổi Xitrum AI Studio sang macOS**  
> **Thư mục dự án**: `D:\Antigravity\REA\REA-project\xitrum-AI-studio`  
> **Phiên bản áp dụng**: v0.4.0+

---

## 1. Đánh Giá Khả Năng Tương Thích Với macOS

Hiện tại mã nguồn gốc **chưa thể chạy ngay lập tức nếu chỉ git clone sang Mac**, nhưng **90% kiến trúc cốt lõi đã sẵn sàng đa nền tảng (Cross-platform Ready)**.

### A. Những thành phần tương thích 100% không cần sửa:
- **Giao diện (Frontend)**: React 19 + TypeScript + Vite + Tailwind CSS chạy thuần WebKit/Safari engine trong Tauri v2.
- **Backend Rust**: `tokio`, `rusqlite`, `image`, `opener`, `uuid` đều tuân theo chuẩn POSIX và hỗ trợ macOS nguyên bản.
- **RPA Engine**: Playwright Core kết nối Google Chrome CDP trên macOS rất mượt và ổn định.
- **Mô hình AI Local (ONNX Runtime)**: Crate `ort` hỗ trợ CoreML Execution Provider của Apple, giúp xử lý Rembg (xóa phông) bằng Apple Neural Engine (NPU) cực kỳ nhanh.

### B. Những rào cản Windows-specific hiện tại cần xử lý:

1. **File nhị phân Sidecars trong `src-tauri/binaries/`**:
   - Hiện tại thư mục chỉ có file Windows: `ffmpeg-x86_64-pc-windows-msvc.exe` và `whisper-cli-x86_64-pc-windows-msvc.exe` kèm các file `.dll`.
   - Tauri v2 quy định tên file sidecar phải chứa **Target Triple** của hệ điều hành đích:
     - Với Mac Apple Silicon (M1/M2/M3/M4): Cần `ffmpeg-aarch64-apple-darwin` và `whisper-cli-aarch64-apple-darwin`.
     - Với Mac chip Intel: Cần `ffmpeg-x86_64-apple-darwin` và `whisper-cli-x86_64-apple-darwin`.

2. **Đường dẫn thư mục mặc định (Default Paths)**:
   - Các giá trị cấu hình mặc định trong `models.rs` và `App.tsx` đang gán đường dẫn ổ đĩa Windows:
     `D:\Antigravity\REA\REA-project\poc-phase0\chrome-profile`
   - Trên macOS, thư mục Application Support / Chrome Profile nằm ở:
     `~/Library/Application Support/Google/Chrome/Default` hoặc thư mục tự chọn của người dùng.

3. **Khai báo tài nguyên trong `src-tauri/tauri.conf.json`**:
   - Mục `"resources": ["binaries/*.dll"]` chỉ dành riêng cho Windows, trên macOS Whisper có thể build dạng static binary (không phụ thuộc DLL) hoặc `.dylib`.

---

## 2. Các Bước Chuyển Đổi & Cài Đặt Trên macOS

### Bước 1: Chuẩn bị môi trường trên macOS
```bash
# 1. Cài đặt Homebrew (nếu chưa có)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Cài đặt Node.js và Rust
brew install node
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

### Bước 2: Chuẩn bị Sidecar Binaries cho macOS
1. **FFmpeg**:
   ```bash
   brew install ffmpeg
   # Lấy target triple của máy
   rustc -vV | grep "host:" # Thường ra aarch64-apple-darwin
   
   # Copy ffmpeg vào thư mục binaries của project
   cp $(which ffmpeg) src-tauri/binaries/ffmpeg-aarch64-apple-darwin
   chmod +x src-tauri/binaries/ffmpeg-aarch64-apple-darwin
   ```

2. **Whisper.cpp CLI**:
   ```bash
   # Clone và build whisper.cpp với hỗ trợ Metal Acceleration của Apple Silicon
   git clone https://github.com/ggerganov/whisper.cpp.git
   cd whisper.cpp
   cmake -B build -DGGML_METAL=ON
   cmake --build build --config Release
   
   # Copy file binary whisper-cli vào dự án
   cp build/bin/whisper-cli /path/to/xitrum-AI-studio/src-tauri/binaries/whisper-cli-aarch64-apple-darwin
   chmod +x /path/to/xitrum-AI-studio/src-tauri/binaries/whisper-cli-aarch64-apple-darwin
   ```

### Bước 3: Cập nhật đường dẫn linh hoạt (Cross-platform Path Handling)
Chuyển đổi giá trị khởi tạo `chrome_profile_dir` trong backend Rust sang tự động nhận diện `dirs::data_local_dir()` hoặc `dirs::home_dir()`.

### Bước 4: Khởi chạy ứng dụng
```bash
npm install
npm run tauri dev
```

---

## 3. Ưu Điểm Khi Vận Hành Trên macOS (Apple Silicon)
- **Tốc độ AI cực nhanh**: Tận dụng GPU Metal & Apple Neural Engine cho Whisper STT và Rembg ONNX.
- **Thời lượng pin & nhiệt độ**: Tiêu thụ điện năng và tỏa nhiệt thấp hơn đáng kể so với máy Windows khi xử lý video và AI đa luồng.
- **Tiết kiệm tài nguyên**: Tauri v2 trên macOS sử dụng WKWebView gốc giúp kích thước gói cài đặt chỉ khoảng ~25 MB và tiêu tốn chưa đầy 50 MB RAM.
