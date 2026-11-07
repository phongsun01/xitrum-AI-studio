# Hướng Dẫn Porting & Vận Hành Trên macOS (Apple Silicon & Intel)

> **Tài liệu phân tích khả năng tương thích và hướng dẫn vận hành Xitrum AI Studio trên macOS**  
> **Thư mục dự án**: `xitrum-AI-studio`  
> **Phiên bản áp dụng**: v0.6.4+

---

## 1. Đánh Giá Khả Năng Tương Thích Với macOS

Kiến trúc cốt lõi của Xitrum AI Studio được xây dựng hướng đến đa nền tảng (Cross-platform):

### A. Những thành phần tương thích 100%:
- **Giao diện (Frontend)**: React 19 + TypeScript + Vite + Tailwind CSS chạy thuần WebKit/Safari engine trong Tauri v2.
- **Backend Rust**: `tokio`, `rusqlite`, `image`, `opener`, `uuid` tuân theo chuẩn POSIX và hỗ trợ macOS nguyên bản.
- **RPA Engine**: Playwright Core kết nối Google Chrome CDP trên macOS ổn định.
- **Mô hình AI Local (ONNX Runtime)**: Crate `ort` hỗ trợ CoreML Execution Provider của Apple, xử lý Rembg (xóa phông) bằng Apple Neural Engine (NPU).
- **Whiteboard Engine & VieNeu-TTS**: Chạy qua tiến trình Python tách biệt bằng giao thức JSON-RPC qua `stdin/stdout`.

### B. Các điểm cần cấu hình cho macOS:
1. **Sidecar Binaries trong `src-tauri/binaries/`**:
   - Tauri v2 quy định file sidecar phải chứa **Target Triple** của hệ điều hành đích:
     - Với Mac Apple Silicon (M1/M2/M3/M4): Cần `ffmpeg-aarch64-apple-darwin` và `whisper-cli-aarch64-apple-darwin`.
     - Với Mac chip Intel: Cần `ffmpeg-x86_64-apple-darwin` và `whisper-cli-x86_64-apple-darwin`.
2. **Đường dẫn thư mục**:
   - Đã được cập nhật sang dùng crate `dirs` tự động phân giải:
     - Profile Chrome: `~/Library/Application Support/XitrumAI/chrome-profile` (macOS) hoặc `%LOCALAPPDATA%\XitrumAI\chrome-profile` (Windows).
     - Output video: `~/Movies/XitrumAI_Outputs` hoặc `~/Videos/XitrumAI_Outputs`.
     - Models AI: Tự tìm kiếm trong `resources`, `src-tauri/resources`, `models` và thư mục Application Support của hệ điều hành.

---

## 2. Các Bước Cài Đặt & Vận Hành Trên macOS

### Bước 1: Chuẩn bị môi trường (Terminal)
```bash
# 1. Cài đặt Homebrew (nếu chưa có)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Cài đặt Node.js, FFmpeg và Rust
brew install node ffmpeg
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

### Bước 2: Chuẩn bị Sidecar Binaries cho macOS
Tạo thư mục `src-tauri/binaries` và cấu hình các binary cho kiến trúc máy (thường là `aarch64-apple-darwin` cho Mac M-series):

```bash
cd /Users/xitrum/Documents/Dev/REA/xitrum-AI-studio
mkdir -p src-tauri/binaries

# 1. Liên kết FFmpeg đã cài từ brew sang sidecar của Tauri:
TRIPLE=$(rustc -vV | sed -n 's/^host: //p') # Ví dụ: aarch64-apple-darwin
cp $(which ffmpeg) "src-tauri/binaries/ffmpeg-${TRIPLE}"
chmod +x "src-tauri/binaries/ffmpeg-${TRIPLE}"

# 2. Cung cấp whisper-cli:
# Cách A (Dùng tạm file rỗng để chạy dev giao diện/whiteboard/TTS trước):
touch "src-tauri/binaries/whisper-cli-${TRIPLE}"
chmod +x "src-tauri/binaries/whisper-cli-${TRIPLE}"

# Cách B (Build whisper.cpp tận dụng Metal tăng tốc phần cứng):
# git clone https://github.com/ggerganov/whisper.cpp.git /tmp/whisper.cpp
# cd /tmp/whisper.cpp && cmake -B build -DGGML_METAL=ON && cmake --build build --config Release
# cp build/bin/whisper-cli "/Users/xitrum/Documents/Dev/REA/xitrum-AI-studio/src-tauri/binaries/whisper-cli-${TRIPLE}"
# chmod +x "/Users/xitrum/Documents/Dev/REA/xitrum-AI-studio/src-tauri/binaries/whisper-cli-${TRIPLE}"
```

### Bước 3: Cài đặt Dependencies & Khởi chạy ứng dụng
```bash
cd /Users/xitrum/Documents/Dev/REA/xitrum-AI-studio
npm install
npm run tauri dev
```

---

## 3. Ưu Điểm Khi Vận Hành Trên macOS (Apple Silicon)
- **Tốc độ AI cực nhanh**: Tận dụng GPU Metal & Apple Neural Engine cho Whisper STT và Rembg ONNX.
- **Tiêu thụ điện năng và tỏa nhiệt thấp**: Tối ưu pin và luồng xử lý video đa tiến trình.
- **Tiết kiệm RAM**: Tauri v2 sử dụng WKWebView gốc giúp app nhẹ (~25 MB dung lượng, tiêu tốn ít RAM hơn rất nhiều so với Electron).
