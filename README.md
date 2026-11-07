# 🚀 Xitrum AI Studio

> **Hệ thống tạo video & audio tự động hóa toàn diện từ Ý Tưởng → Kịch Bản → Giọng Đọc → Video → Hậu Kỳ hoàn chỉnh**  
> Được xây dựng trên nền tảng **Tauri v2 + Rust + React 19 / TypeScript** siêu nhẹ dành cho Windows.

---

## 📦 Phiên Bản Hiện Tại: v0.7.0 (macOS Native Support, Whiteboard Explainer Animation & 100% Offline Engine) (Kỷ Nguyên "Ý Tưởng → Video" & Hậu Kỳ Tự Động)

Nâng cấp mang tính đột phá dựa trên nghiên cứu kiến trúc Muse AI Studio và tích hợp công nghệ AI giọng nói tiếng Việt VieNeu-TTS:

### 🌟 1. Phân Hệ Ý Tưởng → Video & Character Bible (Mốc 1)
- **Chuẩn Hóa Prompt Chatbot**: Cung cấp mẫu prompt JSON chuẩn hóa để sao chép sang ChatGPT / Claude / Gemini sinh kịch bản phân cảnh chi tiết.
- **Trình Phân Tích JSON Thông Minh**: Tự động làm sạch các ký tự đặc biệt, smart quotes (`“ ” « »`), mã BOM, cắt lọc JSON chính xác 100%.
- **Character Bible & Giữ Mặt Nhân Vật Đồng Nhất**: Quản lý dàn nhân vật, mô tả ngoại hình, gán ảnh khuôn mặt tham chiếu cố định xuyên suốt tất cả các cảnh.
- **Biên Tập Phân Cảnh (Script Review UI)**: Quản lý lời thoại tiếng Việt, Visual prompt (tạo ảnh), Video prompt (chuyển động), thời lượng từng cảnh.

### 🎙️ 2. Offline Vietnamese TTS Engine - VieNeu-TTS (Mốc 2)
- **Giao Tiếp JSON-RPC Siêu Nhẹ**: Chạy độc lập qua `stdin/stdout` sidecar Python (không mở cổng HTTP để tránh xung đột port hay firewall).
- **23 Giọng Đọc Tiếng Việt 3 Miền**: Giọng Bắc, Trung, Nam, nam/nữ, giọng đọc truyện, review phim truyền cảm.
- **Audio-Driven Timing**: Tự động đo thời lượng audio thật của file `.wav` sinh ra và tự động cập nhật thời lượng cho từng cảnh.

### 🌐 3. Quản Lý Proxy Bảo Mật & Chuẩn Hóa Runner (Mốc 3)
- **Mã Hóa Mật Khẩu An Toàn**: Lưu trữ mật khẩu proxy an toàn trong SQLite bằng thuật toán mã hóa (không lưu plain text).
- **Đo Ping & Kiểm Tra IP Thực Tế**: Đo latency mili-giây, phát hiện IP ngoại, dọn dẹp proxy chết 1 chạm.
- **Dynamic Paths & Sạch Sẽ**: Loại bỏ hoàn toàn đường dẫn cứng; loại bỏ cờ phát hiện tự động hóa `--disable-blink-features=AutomationControlled`.

### 🚀 4. Điều Phối Hàng Đợi Sinh Video Tự Động (Mốc 4)
- **Mapping Kịch Bản → Task Queue**: Tự động kết hợp mô tả nhân vật + prompt cảnh + đính kèm ảnh tham chiếu khuôn mặt + gán proxy bảo mật vào Task Queue.
- **Giám sát đa luồng độc lập (Multi-lane Semaphores)**: Phân tách luồng tác vụ Cloud và tác vụ Local mượt mà.


### 🎨 6. Phân Hệ Hoạt Hình Bảng Trắng Vẽ Tay (Whiteboard Explainer - F16)
- **100% Offline Local Engine**: Tích hợp module Python Sidecar sidecar-whiteboard độc lập chạy qua JSON-RPC, không tốn credit Cloud hay API bên ngoài.
- **Dàn Dựng Mask Partition**: Phân chia các phân vùng xuất hiện theo timeline kịch bản phụ đề SRT.
- **Nét Vẽ Dòng Chảy Liên Tục (Stream Ink → Color)**: Đầu bút vẽ trượt mượt mà dọc theo khung xương/lưới đối tượng (ink nét phác trước, color tô màu sau).
- **Tab Biên Tập Trực Quan**: Phân tích SRT, tạo cấu hình mẫu nnotation.json và xuất video MP4 hoàn chỉnh với tốc độ cao.

### 🎬 5. Hậu Kỳ Hoàn Chỉnh & Trình Phát Video Xem Trước (Mốc 5)
- **Ghép Video Clips Thông Minh**: Tự động ghép nối các cảnh theo đúng thứ tự (hỗ trợ cả video thật lẫn slide màu dự phòng thông minh).
- **Đồng Bộ Giọng Đọc Đa Nhân Vật**: Nối chính xác audio giọng đọc tương ứng từng phân cảnh.
- **Phụ Đề Tự Động (SRT Hardsub)**: Tự động tính toán mốc thời gian phụ đề khớp từng mili-giây và burn font chữ tiếng Việt trực tiếp lên video.
- **Nhạc Nền BGM Ducking**: Tự động hòa trộn nhạc nền và hạ âm lượng khi có giọng nói nhân vật.
- **Trình Phát Video Xem Trước**: Tích hợp Player xem trước ngay trên giao diện ứng dụng.

---

## ✨ 3 Luồng Vận Hành Video Linh Hoạt

1. **Luồng 1 (Mới)**: **Ý Tưởng → Video**: Nhập ý tưởng ngắn ➜ Nạp kịch bản JSON ➜ Gán giọng & ảnh nhân vật ➜ Sinh video ➜ Xuất video thành phẩm.
2. **Luồng 2**: **Audio → Video (Whisper STT Workflow)**: Thu âm giọng đọc ➜ Bóc tách timeline câu chữ ➜ Gán ảnh mẫu ➜ Sinh clip ➜ Tự động ghép clip.
3. **Luồng 3**: **Tạo Video Lẻ Nhanh**: Nhập Prompt + Ảnh mẫu ➜ Thêm vào hàng đợi sinh clip lẻ.

---

## 🛠️ Công Nghệ Sử Dụng

- **Backend**: Rust 2021, Tauri v2, Tokio, Rusqlite, ONNX Runtime (`ort`), `opener`, `reqwest`, `url`, `base64`.
- **Frontend**: React 19, TypeScript, Vite, `lucide-react`.
- **RPA Engine**: Playwright Core kết nối Chrome CDP an toàn qua Proxy.
- **TTS Engine**: VieNeu-TTS (Python JSON-RPC sidecar).
- **Media Engine**: FFmpeg & Whisper.cpp portable sidecars.

---

## 💻 Hướng Dẫn Cài Đặt & Phát Triển

### Yêu cầu:
- Windows 10 / 11 64-bit
- Node.js >= 20
- Rust toolchain (`rustup`)
- Python 3.10+ (có `py.exe` hoặc Python Launcher)
- Microsoft C++ Build Tools 2022

### Cài đặt dependencies:
```powershell
# 1. Cài đặt Node dependencies (bao gồm playwright-core)
npm install

# 2. Cài đặt Python packages cho VieNeu-TTS (nếu dùng tính năng Ý Tưởng -> Video)
py -m pip install -r sidecar-tts/requirements.txt
```

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
- [x] **v0.3.0**: Audio Timeline Segment Editor, Xuất phụ đề (.SRT/.TXT), Chọn mô hình Whisper, Duyệt câu thoại.
- [x] **v0.4.0**: Runner Muse.ai tự động hoàn chỉnh, Tự động ghép video + nhạc nền, Multi-lane runner đa luồng.
- [x] **v0.5.0** (Internal / Milestone): Tích hợp Sidecar JSON-RPC VieNeu-TTS và kiến trúc Character Bible.
- [x] **v0.6.1**: Đường ống "Ý Tưởng → Video" hoàn chỉnh, VieNeu-TTS tiếng Việt, Proxy Manager, Hậu kỳ FFmpeg (SRT Hardsub + BGM Sidechain Ducking).

---

## 📄 Bản Quyền
Dự án được phân phối theo giấy phép MIT License (xem chi tiết tại `LICENSE`). Mọi thành phần mã nguồn mở tuân thủ điều khoản tương ứng của tác giả.
