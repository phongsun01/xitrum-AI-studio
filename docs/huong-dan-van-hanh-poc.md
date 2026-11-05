# Hướng Dẫn Sử Dụng & Vận Hành PoC Phase 0

> **Tài liệu theo dõi và hướng dẫn sử dụng các script PoC độc lập**  
> **Thư mục làm việc**: `D:\Antigravity\REA\project-docs\poc-phase0`  
> **Cập nhật lần cuối**: 2026-11-05

---

## 1. Module Tự Động Hóa Muse.ai (PoC 0.1)

### A. Kiểm tra trạng thái đăng nhập tự động
Script kiểm tra ngầm (headless) xem session trên profile Chrome còn hiệu lực hay không:

```powershell
$env:NODE_PATH="d:\Antigravity\REA\project-docs\extracted-kahi\raw\app.asar.unpacked\node_modules"
node "d:\Antigravity\REA\project-docs\poc-phase0\check_login.mjs"
```
- Nếu output: `Khung soạn thảo tin nhắn (Composer): CÓ` => Đã đăng nhập và phiên còn hạn.
- Nếu output: `CHƯA ĐĂNG NHẬP HOẶC SESSION ĐÃ HẾT HẠN` => Cần đăng nhập lại.

---

### B. Cách đăng nhập lại khi bị khóa hoặc đổi tài khoản
Vì bạn sử dụng tài khoản phụ nên có thể gặp tình trạng bị khóa tài khoản hoặc hết phiên đăng nhập. Khi đó, hãy chạy script `relogin.mjs`:

```powershell
$env:NODE_PATH="d:\Antigravity\REA\project-docs\extracted-kahi\raw\app.asar.unpacked\node_modules"
node "d:\Antigravity\REA\project-docs\poc-phase0\relogin.mjs"
```

**Các bước thao tác:**
1. Cửa sổ Google Chrome thật với profile riêng sẽ xuất hiện trên màn hình tại trang đăng nhập Muse.ai.
2. Nếu tài khoản cũ bị khóa: bấm Đăng xuất (Logout) hoặc chuyển tài khoản.
3. Đăng nhập tài khoản mới (Google, Email, hoặc phương thức bạn dùng).
4. Khi đã vào được giao diện chính của Muse.ai, **bạn chỉ cần đóng cửa sổ trình duyệt Chrome lại**.
5. Script sẽ tự động lưu phiên mới vào thư mục `chrome-profile` vĩnh viễn cho các lần chạy sau.

---

## 2. Module Xử Lý Âm Thanh & Bóc Tách Timeline (PoC 0.2)

### Quy trình hoạt động:
```
[File Audio bất kỳ: MP3, M4A, FLAC...]
         │
         ▼ (FFmpeg)
[Audio chuẩn hóa: WAV 16000Hz, Mono, 16-bit PCM]
         │
         ▼ (whisper-cli.exe)
[File JSON chứa timeline câu chữ, millisecond, text]
```

### Công cụ đã cài đặt sẵn trong `poc-phase0/tools/`:
- **FFmpeg**: `poc-phase0/tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe`
- **Whisper**: `poc-phase0/tools/whisper/Release/whisper-cli.exe`
- **Model test**: `poc-phase0/tools/whisper/models/ggml-tiny.bin` (Bản production sẽ dùng `whisper-large-v3-turbo`)

### Lệnh chạy kiểm tra chuyển đổi & phân tích:
```powershell
# Bước 1: Chuẩn hóa audio sang WAV 16kHz
& "d:\Antigravity\REA\project-docs\poc-phase0\tools\ffmpeg\ffmpeg-9.0.2-essentials_build\bin\ffmpeg.exe" -y -i "duong_dan_file_audio.mp3" -ar 16000 -ac 1 -c:a pcm_s16le "d:\Antigravity\REA\project-docs\poc-phase0\audio_16k.wav"

# Bước 2: Chạy Whisper bóc tách ra JSON
& "d:\Antigravity\REA\project-docs\poc-phase0\tools\whisper\Release\whisper-cli.exe" -m "d:\Antigravity\REA\project-docs\poc-phase0\tools\whisper\models\ggml-tiny.bin" -f "d:\Antigravity\REA\project-docs\poc-phase0\audio_16k.wav" -oj -of "d:\Antigravity\REA\project-docs\poc-phase0\ket_qua_timeline"
```

File kết quả `ket_qua_timeline.json` sẽ chứa cấu trúc:
```json
"transcription": [
  {
    "timestamps": {
      "from": "00:00:00,000",
      "to": "00:00:10,500"
    },
    "offsets": {
      "from": 0,
      "to": 10500
    },
    "text": " Nội dung câu nói bóc tách được..."
  }
]
```
Thời gian xử lý: ~**1.3 giây** cho 11 giây audio (nhanh hơn thời gian thực gấp 8 lần trên CPU).



---

## 3. Module Tách Nền Ảnh (PoC 0.3 - Rust Rembg ONNX)

### Quy trình hoạt động:
```
[Ảnh gốc: JPG, PNG, WEBP...]
         │
         ▼ (Rust Image crate)
[Resize 320x320 & Chuẩn hóa ImageNet Tensor: (1, 3, 320, 320)]
         │
         ▼ (ort 2.0-rc + u2netp.onnx)
[Inference sinh Alpha Mask nhị phân (102,400 điểm ảnh)]
         │
         ▼ (Bicubic Upscale & Alpha Blending)
[Ảnh PNG trong suốt giữ nguyên kích thước và chất lượng gốc]
```

### Cách chạy kiểm tra PoC 0.3:
Dự án PoC Rust được đặt tại `poc-phase0/poc_rembg`:

```powershell
cd d:\Antigravity\REA\project-docs\poc-phase0\poc_rembg
& "$env:USERPROFILE\.cargo\bin\cargo.exe" run
```

### Kết quả đo lường:
- Model: `u2netp.onnx` siêu nhẹ (**4.5 MB** so với bản u2net gốc 176 MB).
- Thời gian suy luận (Inference) trên CPU: **~0.15 - 0.25 giây / ảnh**.
- Bộ nhớ tiêu thụ: Cực thấp (< 60 MB RAM), không gây rò rỉ bộ nhớ, xử lý hoàn toàn offline.
- File xuất ra: `output.png` với kênh Alpha tách nền chuẩn xác.


---

## 4. Module Kiểm Thử Đường Dẫn Tiếng Việt Có Dấu & Khoảng Trắng (PoC 0.4)

### Hiện tượng phát hiện được (Critical Edge-Case):
- **FFmpeg**: Hỗ trợ Unicode / UTF-8 rất tốt trên Windows. Đường dẫn có dấu tiếng Việt (ví dụ: `d:\...\Thư Mục Tiếng Việt Có Dấu Và Khoảng Trắng\bài hát test có dấu.mp3`) hoạt động bình thường, không bị lỗi.
- **Whisper.cpp (whisper-cli.exe)**: Sử dụng hàm mở file C standard runtime (`fopen`) trên Windows không hỗ trợ đường dẫn Unicode UTF-8 trực tiếp từ command line, dẫn đến lỗi:
  ```text
  error: input file not found 'd:\...\Thu M?c Ti?ng Vi?t C D?u...': no input files specified
  ```

### Giải pháp xử lý triệt để trong Rust (Architecture Invariant):
Có 2 phương án đã được kiểm chứng hoạt động 100%:

1. **Phương án A (Tốt nhất trong Rust - Temporary Working Dir)**:
   Khi nhận file audio tiếng Việt từ người dùng, Rust Backend sẽ:
   - Dùng `ffmpeg` convert trực tiếp từ file gốc sang file WAV tạm trong thư mục `%TEMP%` hoặc `app_cache` (đường dẫn ASCII chuẩn không dấu).
   - Truyền file WAV tạm này cho `whisper-cli.exe`.
   - Đọc kết quả JSON trả về cho giao diện và xóa file tạm.
2. **Phương án B (Windows 8.3 Short Path)**:
   Sử dụng API Windows `GetShortPathNameW` chuyển đường dẫn Unicode dài thành định dạng ngắn tương thích 8.3 (ví dụ: `D:\ANTIGR~1\REA\...\THMCTI~1\KTQUMT~1.WAV`).
   - Đã test thực tế: `whisper-cli.exe` đọc thành công 100% khi dùng Short Path.


---

## 5. Khung Ứng Dụng Tauri v2 + Rust (Giai Đoạn 1)

### Vị trí dự án:
`D:\Antigravity\REA\project-docs\xitrum-AI-studio`

### Cấu trúc đã thiết lập:
- **Rust Backend**: `src-tauri/` với `tauri.conf.json` v2, cấu hình capabilities, security, IPC commands.
- **Sidecar Binaries**: Đã copy và đổi tên chuẩn theo target triple của Windows (`x86_64-pc-windows-msvc`):
  - `src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe`
  - `src-tauri/binaries/whisper-cli-x86_64-pc-windows-msvc.exe` kèm toàn bộ file thư viện DLL runtime.
- **Resources**: Đã nhúng mô hình `u2netp.onnx` và cấu hình `selectors.default.json` vào ứng dụng.
- **Frontend**: React 19 + TypeScript + Vite, gọi command `greet` và `test_ffmpeg_sidecar` qua `@tauri-apps/api/core`.

### Lệnh chạy chế độ phát triển (Development):
Mở một cửa sổ terminal mới và chạy:
```powershell
$env:PATH="$env:USERPROFILE\.cargo\bin;" + $env:PATH
cd "d:\Antigravity\REA\project-docs\my-kahi-tauri"
npm run tauri dev
```
Ứng dụng sẽ tự động khởi động cửa sổ desktop Windows siêu nhẹ, gọi command Rust và kích hoạt sidecar FFmpeg thành công.


---

## 6. Lõi Quản Lý Hàng Đợi & Cơ Sở Dữ Liệu SQLite (Giai Đoạn 2)

### Các module đã xây dựng trong `src-tauri/src/`:
1. **`models.rs`**: Khai báo struct `TaskItem`, `TaskKind` (MuseVideo, MuseImage, WhisperStt, Rembg, FfmpegRender), `TaskStatus` và `AppConfig`.
2. **`errors.rs`**: Quản lý lỗi tập trung bằng `thiserror` (`AppError::Db`, `AppError::Queue`, `AppError::NotFound`...) serialize trực tiếp sang JSON trả về cho React UI.
3. **`db.rs`**:
   - Sử dụng thư viện `rusqlite` nhúng sẵn.
   - Tự động tạo bảng `tasks` và bảng `settings`.
   - Cơ chế tự phục hồi: Tự động reset các task đang ở trạng thái `running` thành `queued` khi ứng dụng khởi động lại sau crash/tắt đột ngột.
4. **`queue.rs`**:
   - Xây dựng theo mô hình **Tokio Actor Loop** (`mpsc::channel`).
   - Quản lý `CancellationToken` cho từng task để người dùng có thể bấm nút **Hủy (Cancel)** bất cứ lúc nào, triệt tiêu tiến trình con mà không để lại zombie process.
5. **`commands.rs`**: Các IPC commands:
   - `enqueue_task`: Thêm tác vụ vào hàng đợi.
   - `cancel_task`: Hủy tác vụ đang chạy.
   - `list_tasks`: Lấy danh sách tác vụ hiển thị lên bảng.
   - `get_settings` & `save_settings`: Lưu/đọc cấu hình.


---

## 7. Đấu Nối Thực Tế Các AI Executor Vào Hàng Đợi (Giai Đoạn 3)

### Các module Executor đã tích hợp:
1. **`src-tauri/src/executors/rembg.rs`**:
   - Sử dụng `ort 2.0-rc` tải mô hình `u2netp.onnx`.
   - Hàm `remove_background(input, output)`: Tiền xử lý tensor `(1, 3, 320, 320)` -> Suy luận sinh mask -> Ghép alpha channel và xuất ra file PNG trong suốt.
   - Chạy trên thread pool độc lập bằng `tokio::task::spawn_blocking` để không nghẽn Tokio runtime.
2. **`src-tauri/src/executors/audio.rs`**:
   - Tích hợp pipeline 2 giai đoạn: `AudioPipeline::process_stt`.
   - Giai đoạn 1: Gọi `ffmpeg` sidecar convert audio sang WAV 16kHz mono vào thư mục `%TEMP%`.
   - Giai đoạn 2: Gọi `whisper-cli` sidecar bóc tách audio sang file `.json` timeline.
   - Hỗ trợ `CancellationToken`: Giết tiến trình con ngay lập tức và dọn dẹp file tạm nếu người dùng bấm Hủy.
3. **`sidecar-muse/runner.mjs`**:
   - Script Node.js giao tiếp qua stdio JSON-lines (`ready`, `progress`, `success`, `error`).
   - Mở Google Chrome profile thật, điều hướng tới `https://muse.ai/thread/new`, nhập prompt và đợi tải video hoàn tất.
4. **Giao diện đa tab (`App.tsx`)**:
   - Tab 1: **🎬 Tạo Video Muse.ai** (Prompt, Tỉ lệ 16:9 / 9:16).
   - Tab 2: **🎙️ Bóc Tách Audio (Whisper)** (Nhập file audio -> Xuất timeline JSON).
   - Tab 3: **✂️ Tách Nền Ảnh (Rembg ONNX)** (Nhập file ảnh -> Xuất PNG trong suốt).
   - Bảng hàng đợi realtime cập nhật trạng thái `running`, `progress%`, `output_path` và nút Hủy.


---

## 8. Giao Diện Người Dùng Chuyên Nghiệp (Giai Đoạn 4)

### Cải tiến giao diện:
1. **Lớp Adapter `src/api.ts`**:
   - Đóng gói toàn bộ các hàm gọi `invoke` và tích hợp `@tauri-apps/plugin-dialog` cho phép mở hộp thoại Windows Native File Picker (chọn file âm thanh, ảnh, thư mục lưu kết quả trực tiếp).
2. **Sidebar Navigation & Theme hiện đại**:
   - Thiết kế giao diện Dashboard gồm thanh điều hướng Sidebar bên trái và khu vực tác vụ bên phải với icon từ `lucide-react`.
   - **4 Tab chức năng**:
     - 🎬 **Tạo Video Muse.ai**: Form nhập prompt, chọn tỉ lệ (16:9, 9:16, 1:1), nút gửi task.
     - 🎙️ **Bóc Tách Audio (Whisper)**: Nút "Chọn File..." mở file explorer Windows chọn file MP3/WAV/M4A, bấm bóc tách timeline.
     - ✂️ **Tách Nền Ảnh (Rembg)**: Nút "Chọn Ảnh..." mở file explorer chọn PNG/JPG/WebP, bấm tách nền siêu tốc.
     - ⚙️ **Cài Đặt Hệ Thống**: Xem và đổi thư mục lưu file kết quả (`D:\XitrumAI_Outputs`), chọn tỉ lệ mặc định.
3. **Bảng Hàng Đợi (Queue Dashboard)**:
   - Hiển thị badge trạng thái màu sắc (`running`, `success`, `failed`, `cancelled`).
   - Thanh tiến độ (Progress bar) động hiển thị % thực tế.
   - Nút Hủy (Cancel) trực quan đối với các task đang chạy.


---

## 9. Đóng Gói Hoàn Thiện Bộ Cài Đặt (Giai Đoạn 5)

### Thành quả đóng gói Release:
Lệnh `npm run tauri build` đã hoàn thành thành công trong chế độ tối ưu hóa cao:
1. **File thực thi độc lập (Standalone EXE)**:
   - Đường dẫn: `src-tauri/target/release/xitrum-ai-studio.exe`
2. **Bộ cài đặt NSIS Setup (.exe)**:
   - Đường dẫn: `src-tauri/target/release/bundle/nsis/Xitrum AI Studio_0.1.0_x64-setup.exe`
   - Dung lượng: **~41.65 MB** (So với Kahi AI bản cũ cồng kềnh hơn 250 MB).
3. **Bộ cài đặt Windows Installer (.msi)**:
   - Đường dẫn: `src-tauri/target/release/bundle/msi/Xitrum AI Studio_0.1.0_x64_en-US.msi`
   - Dung lượng: **~66.85 MB** (Đã tích hợp trọn bộ FFmpeg sidecar, Whisper-cli sidecar, GGML runtime DLLs và ONNX Rembg model).
