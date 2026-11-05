# Kế Hoạch Triển Khai Port Ứng Dụng Sang Tauri v2 + Rust

> **Mục tiêu**: Xây dựng lại ứng dụng tương tự **Kahi AI** bằng nền tảng **Tauri v2 + Rust + React/TypeScript**, thay thế toàn bộ lõi cồng kềnh của Electron, giảm dung lượng ứng dụng từ 250MB xuống ~15MB và tiết kiệm RAM tối đa.  
> **Tài liệu tham chiếu**: [kahi-ai-reconstruction-spec.md](file:///d:/Antigravity/REA/project-docs/kahi-ai-reconstruction-spec.md)  
> **Thời gian khởi tạo**: 2026-11-05

---

## 1. Phân Tích Sự Thay Đổi Kiến Trúc (Electron -> Tauri v2)

| Thành phần | Phiên bản cũ (Electron / Kahi AI) | Kiến trúc mới (Tauri v2 + Rust) | Lợi ích |
| :--- | :--- | :--- | :--- |
| **Runtime & Shell** | Electron (Chromium + Node.js nhúng sẵn) | Tauri v2 (Rust Backend + Windows WebView2) | Bộ cài siêu nhẹ (~15MB vs ~250MB), RAM ~60MB vs ~600MB. |
| **Giao tiếp IPC** | `ipcRenderer.invoke` / `ipcMain.handle` (`kahi:invoke`) | Tauri Commands: `#[tauri::command]` + `invoke()` trong TypeScript | Kiểm soát kiểu dữ liệu chặt chẽ (Type-safe), hiệu năng C/Rust gốc. |
| **Web RPA (Muse.ai)** | `playwright-core` (Node.js) | Crate Rust `headless_chrome` / `thirtyfour` hoặc Sidecar Node/Python Playwright | Tự động hóa mượt mà, quản lý headless browser trực tiếp. |
| **Audio (Speech-to-Text)** | `whisper-cli.exe` (gọi subprocess từ Node) | Tauri Sidecar (`whisper-cli.exe`) hoặc nhúng trực tiếp Crate `whisper-rs` | Tận dụng tối đa đa luồng của Rust, parse kết quả JSON tốc độ cao. |
| **Tách nền (Rembg)** | `onnxruntime-node` + `u2net.onnx` | Crate `ort` (ONNX Runtime Rust) + `image` crate hoặc sidecar | Tốc độ xử lý ảnh nhanh hơn 2-3x, không leak memory. |
| **Media Processing** | `ffmpeg` binaries qua `child_process` | Gọi `ffmpeg` qua Tauri Sidecar / Command hoặc crate `ffmpeg-next` | Xử lý ghép video/audio mượt mà. |
| **Giao diện (Frontend)** | React 19 Bundle | React 19 / Vite + Tailwind CSS + Lucide Icons | Tái sử dụng được toàn bộ logic giao diện, form nhập prompt và audio timeline. |

---

## 2. Bảng Checklist Chi Tiết Từng Giai Đoạn

- [ ] **Giai đoạn 1: Chuẩn bị môi trường & Khởi tạo dự án Tauri v2**
  - [ ] 1.1 Cài đặt Microsoft C++ Build Tools & Windows SDK (`winget install Microsoft.VisualStudio.2022.BuildTools`)
  - [ ] 1.2 Cài đặt Rust toolchain (`rustup`, `cargo`, `rustc`)
  - [ ] 1.3 Khởi tạo template `tauri-app` với Vite + React + TypeScript
  - [ ] 1.4 Thiết lập cấu hình `tauri.conf.json` (quyền hạn window, permissions, capabilities)

- [ ] **Giai đoạn 2: Thiết kế hệ thống IPC & State Management (Rust Core)**
  - [ ] 2.1 Định nghĩa các Data Structures trong Rust (`serde` serializable): `AppConfig`, `PromptItem`, `QueueTask`, `AudioSegment`
  - [ ] 2.2 Xây dựng Task Queue Engine trong Rust (`tokio` async channel / mutex queue)
  - [ ] 2.3 Viết các Tauri Commands cơ bản:
    - `get_app_info`
    - `save_settings` / `load_settings`
    - `pick_directory` / `pick_file` (dùng plugin dialog của Tauri)

- [ ] **Giai đoạn 3: Xây dựng Module Tự Động Hóa Muse.ai (Web RPA)**
  - [ ] 3.1 Thiết kế cơ chế Browser Automation:
    - *Phương án A*: Dùng crate Rust `headless_chrome` (thuần Rust, không phụ thuộc runtime ngoài).
    - *Phương án B*: Đóng gói một Sidecar script Playwright gọn nhẹ điều khiển Chrome.
  - [ ] 3.2 Áp dụng bộ Selector & Template prompt đã trích xuất từ Kahi AI (`kahi-ai-reconstruction-spec.md`)
  - [ ] 3.3 Xử lý tải tự động video/ảnh kết quả về thư mục chỉ định

- [ ] **Giai đoạn 4: Xây dựng Module Xử Lý Media & Local AI**
  - [ ] 4.1 Tích hợp `whisper-cli.exe` làm Tauri Sidecar hoặc nhúng `whisper-rs`:
    - Nhận file âm thanh -> Chuyển thành WAV 16kHz -> Xuất JSON timeline câu chữ
  - [ ] 4.2 Tích hợp mô hình tách nền ảnh (`u2net.onnx` hoặc `rmbg`):
    - Đưa ảnh chân dung nhân vật mẫu vào -> Xóa background -> Lưu PNG trong suốt
  - [ ] 4.3 Tích hợp `ffmpeg` sidecar để cắt gọt ghép video/nhạc nền

- [ ] **Giai đoạn 5: Xây dựng Giao diện Người Dùng (React + Vite)**
  - [ ] 5.1 Xây dựng màn hình **Hàng đợi sinh Video/Ảnh** (Batch Prompts, tỉ lệ khung hình 16:9 / 9:16)
  - [ ] 5.2 Xây dựng màn hình **Biên tập Audio & Căn chỉnh Timeline** (phân đoạn kịch bản theo tiếng nói)
  - [ ] 5.3 Xây dựng màn hình **Quản lý Nhân vật Mẫu / Ảnh tham chiếu** (kèm nút xóa phông 1-click)
  - [ ] 5.4 Màn hình **Cài đặt & Tải Model** (cho phép tải Whisper models, cấu hình thư mục lưu)

- [ ] **Giai đoạn 6: Kiểm thử, Tối ưu & Đóng gói sản phẩm**
  - [ ] 6.1 Test tải video hàng loạt trong hàng đợi (Stress test queue & memory)
  - [ ] 6.2 Đóng gói file cài đặt Windows MSI / EXE bằng `npm run tauri build`
  - [ ] 6.3 Đo đạc dung lượng cài đặt và mức tiêu thụ tài nguyên thực tế

---

## 3. Cấu Trúc Thư Mục Dự Kiến Của Dự Án

```
my-kahi-tauri/
├── src-tauri/                 # Backend Rust
│   ├── Cargo.toml             # Rust dependencies (tauri, tokio, serde, etc.)
│   ├── tauri.conf.json        # Cấu hình app, permissions, window, sidecars
│   ├── binaries/              # Sidecar binaries (whisper-cli.exe, ffmpeg.exe)
│   └── src/
│       ├── main.rs            # Entrypoint Tauri app
│       ├── commands/          # Các hàm xử lý IPC (invoke handlers)
│       │   ├── queue.rs       # Quản lý hàng đợi tạo video
│       │   ├── audio.rs       # Gọi Whisper & xử lý âm thanh
│       │   ├── rembg.rs       # Tách nền ảnh ONNX
│       │   └── settings.rs    # Lưu cấu hình
│       ├── automation/        # Engine điều khiển Muse.ai
│       │   └── muse_runner.rs
│       └── models/            # Khai báo Struct dữ liệu (DTOs)
├── src/                       # Frontend (React 19 + TypeScript + Vite)
│   ├── components/            # UI components (QueueTable, Timeline, PromptInput)
│   ├── hooks/                 # Hooks gọi invoke() tới Rust
│   ├── pages/                 # Màn hình chính (Queue, AudioStudio, References, Settings)
│   ├── App.tsx
│   └── main.tsx
└── package.json
```

---

## 4. Nhật Ký Thực Hiện (Execution Log)

| Bước | Thời điểm | Trạng thái | Ghi chú & Xử lý lỗi |
| :--- | :--- | :--- | :--- |
| **Lập kế hoạch** | 12:13 | Đã khởi tạo | Hoàn thành tài liệu kế hoạch chi tiết port sang Tauri v2 + Rust |

---

