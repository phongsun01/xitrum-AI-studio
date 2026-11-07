# 🚀 Xitrum AI Studio

> **Hệ thống tạo video & audio tự động hóa toàn diện từ Ý Tưởng → Kịch Bản → Giọng Đọc → Video → Hậu Kỳ hoàn chỉnh**  
> Được xây dựng trên nền tảng **Tauri v2 + Rust + React 19 / TypeScript** siêu nhẹ dành cho Windows.

---

## 📦 Phiên Bản Hiện Tại: v0.7.7 (Audio-Driven Compact Timeline, Rich Thumbnail Generator & Character Bible Expansion)

Nâng cấp quan trọng phân hệ **Whiteboard Explainer Animation** với cơ chế căn chỉnh timeline theo giọng đọc và tạo thumbnail chuyên nghiệp:

### ⏱️ 1. Căn Chỉnh Timeline Theo Giọng Đọc Thực Tế (Audio-Driven Compact Timeline)
- **Tự Động Nén Thời Gian Cảnh (Compact Scene Windows)**: Tự động căn chỉnh và co giãn thời lượng cảnh khớp chính xác theo tốc độ đọc TTS thực tế, tránh các khoảng lặng thừa và giữ trọn vẹn lời thoại.
- **Bảo Vệ Mapping Cảnh & SRT Nguồn**: Giữ nguyên liên kết ảnh/cảnh với từng nhóm câu phụ đề, không làm lệch hay ghi đè file SRT gốc.

### 🖼️ 2. Trình Tạo Thumbnail Bắt Mắt (Rich Thumbnail Generator & Typography)
- **Thumbnail Khởi Đầu 2 Giây Tự Động**: Tự động render và ghép ảnh bìa (thumbnail) vào 2 giây đầu video thành phẩm.
- **Hệ Thống Phông Chữ Đa Dạng & Stroke/Shadow Hiệu Ứng**: Hỗ trợ 9 phông chữ Việt hóa ấn tượng (Bungee, Montserrat, Bangers, Playfair...) với hiệu ứng viền chữ (stroke), bóng đổ (drop shadow), badge nhãn nổi bật và overlay tương phản cao.

### 👥 3. Mở Rộng Thư Viện Nhân Vật Lịch Sử (Character Bible)
- Bổ sung bộ ảnh minh họa nhân vật lịch sử Tam Quốc chất lượng cao cho kịch bản và hoạt họa bảng trắng.

---

## 📦 Lịch Sử Phiên Bản: v0.7.6 (Whiteboard Pen Preset Selector & Project Metadata Roundtrip)

Cập nhật giao diện và cơ chế quản lý preset bút vẽ cho phân hệ **Whiteboard Explainer Animation**:

### 🖋️ 1. Bộ Chọn Preset Bút Vẽ Đa Phong Cách (Pen Preset Selector)
- **Tích Hợp Toàn Bộ 10 Mẫu Bút**: Cho phép người dùng trực tiếp lựa chọn giữa các phong cách bút vẽ trong Whiteboard Editor (Bàn tay vẽ dạ mặc định, Bút lông thư pháp, Bút cán tre, Bút máy vintage, Bút vẽ kỹ thuật, Bút lông vũ, Bút cảm ứng digital, Bút cyberpunk dạ quang, Bút pha lê thủy tinh, Đũa phép thuật).
- **Đồng Bộ Hai Chiều Với Dự Án (Metadata Roundtrip)**: Tự động lưu và nạp lại chính xác loại bút đã chọn (`handPath`) khi lưu hoặc mở file dự án Whiteboard `.json`.

---

## 📦 Lịch Sử Phiên Bản: v0.7.5 (Whiteboard Review Hardening, Hand Rig Kinematics & Pen Asset Library)

Đợt nâng cấp toàn diện phân hệ **Whiteboard Explainer Animation** sau đợt kiểm thử và rà soát R1-R7:

### 🖋️ 1. Thư Viện Bút & Hiệu Ứng Bàn Tay Động (R4 Kinematic Hand Rig & R5 Asset Library)
- **Thư Viện Đa Dạng Mẫu Bút**: Bổ sung bộ sưu tập các loại bút (Bút lông thư pháp, bút máy vintage, bút kỹ thuật, bút dạ, đũa phép, bút pha lê...).
- **Cơ Chế Khớp Cổ Tay & Xoay Bút Thực Tế (Kinematic Rig)**: Tự động tính toán góc xoay cổ tay và hướng ngòi bút theo véc-tơ chuyển động vẽ nét.
- **Tùy Chọn Kích Thước Bàn Tay**: Cân chỉnh tỉ lệ tay vẽ hợp lý (~75%) đảm bảo bố cục hài hòa, không che khuất hình vẽ.

### 🎯 2. Trình Biên Tập Vùng Trực Quan & Tách Lớp Thông Minh (R4b & R6 Visual Editor)
- **Subject-First Component Priority**: Ưu tiên phân lớp và vẽ chủ thể chính trước, chi tiết phụ/hậu cảnh sau.
- **Biên Tập Vùng Trực Quan (Elements Editor)**: Xem trước và tinh chỉnh bounding box, thứ tự xuất hiện trực tiếp trên giao diện.

### 📁 3. Quản Lý Thư Mục Dự Án Độc Lập
- **Thư Mục Dự Án `wb-projects/`**: Chuẩn hóa thư mục chứa tài nguyên ảnh/SRT cho các phân cảnh whiteboard và tự động loại trừ khỏi Git để bảo vệ dữ liệu cá nhân.

---

## 📦 Lịch Sử Phiên Bản: v0.7.4 (Whiteboard Project Render Resume, Exact Cues Mapping & Calligraphy Brush Asset)

Nâng cấp quan trọng phân hệ **Whiteboard Explainer Animation** lên chuẩn kiến trúc W0-W5 chuyên nghiệp:

### 🎨 1. Whiteboard Studio Đa Phân Cảnh (Multi-Scene Project W1 & W3/W4)
- **Render Resume Thông Minh**: Cho phép tiếp tục render các cảnh còn lại mà không cần tạo lại từ đầu nếu gặp sự cố hoặc bổ sung cảnh.
- **Khớp Phụ Đề Chính Xác (Exact Cues Mapping)**: Hỗ trợ ánh xạ từng cue thoại SRT thành 1 cảnh riêng biệt chuẩn xác thời lượng.
- **Bút Lông Thư Pháp (Calligraphy Brush Asset)**: Bổ sung asset bút lông truyền thống cho hoạt họa bảng trắng phong cách thư họa.

### 🎙️ 2. Tích Hợp VieNeu-TTS Trực Tiếp Cho Whiteboard (W2)
- **Sinh Giọng Đọc Trực Tiếp Trong Editor**: Chọn giọng đọc tiếng Việt offline (Thùy Dung, Quỳnh Nhi...) và tạo audio kèm thời lượng chính xác cho từng cảnh whiteboard.
- **Hòa Âm & Ghép Nối Nâng Cao**: Ghép các video whiteboard từng cảnh kèm audio đồng bộ hoàn hảo không trễ lệch.

### 🛡️ 3. Tối Ưu Hóa & Bảo Vệ Dữ Liệu
- **Kích Thước Tay Vẽ Tối Ưu**: Điều chỉnh tỷ lệ bàn tay vẽ ~75% tránh che khuất chi tiết quan trọng trên bảng.
- **Bảo Vệ Dữ Liệu Local**: Tự động loại trừ toàn bộ thư mục `input_images/` và `outputs/` trong `.gitignore` khi đóng gói và commit.

---

## 📦 Lịch Sử Phiên Bản: v0.7.2 (G1 Durable Queue & G2 Timeline Media Planner & Media Normalization)

Nâng cấp quan trọng theo kế hoạch kiến trúc G1 & G2 sau phân tích hệ thống Sesame Studio, hoàn thiện tính chịu lỗi hàng đợi và xử lý timeline video/audio trung thực:

### ⏱️ 1. Timeline Media Planner & Mốc Thời Gian Số Nguyên (G2 Timeline)
- **Độ Chính Xác Millisecond (ms)**: Toàn bộ timeline video, audio TTS và phụ đề được tính toán bằng số nguyên ms dựa trên probe độ dài audio/video thực tế.
- **Bảo Vệ Giọng Nói 100%**: Chính sách video ngắn hơn audio sẽ tự động áp dụng đóng băng khung hình cuối (`tpad=stop_mode=clone`), tuyệt đối không âm thầm cắt ngắn lời thoại.
- **Phụ Đề SRT Khớp Tuyệt Đối**: File SRT được tạo trực tiếp từ RenderManifest timeline, đồng bộ hoàn hảo từng frame giữa hình ảnh, giọng đọc và text hiển thị.

### 🎬 2. Chuẩn Hóa Media Đa Nền Tảng Trước Concat (G2 Normalization)
- **Chuẩn Hóa Canvas & Aspect Ratio**: Tự động scale & pad đưa về chuẩn SAR 1:1, hỗ trợ tỷ lệ 16:9 (1280x720), 9:16 (720x1280), 1:1 (1080x1080).
- **Thống Nhất Codec & Audio Format**: Đưa toàn bộ clip về `libx264`, `yuv420p`, cố định `30fps`; audio chuẩn hóa về `pcm_s16le`, `44100Hz`, `stereo` trước khi ghép demuxer.
- **Phân Định Rõ Ràng Preview & Final**: Chế độ **Preview** hỗ trợ tạo slide màu xem trước cho các cảnh chưa sinh video; Chế độ **Final** kiểm tra nghiêm ngặt và chặn xuất nếu thiếu video thực tế.
- **Dọn Dẹp Tự Động**: Tự động dọn toàn bộ file tạm và manifest intermediate ngay cả khi lệnh hủy hoặc gặp lỗi.

### 🛡️ 3. Hàng Đợi Bền Vững & Chống Gửi Trùng Lặp (G1 Durable Queue)
- **ID-Based Queue & Startup Auto Recovery**: Hàng đợi chuyển sang điều phối dựa trên ID, tự động nạp lại các task pending/running từ SQLite khi khởi động ứng dụng.
- **Generation Key Deduplication**: Sinh khóa băm SHA256 từ prompt, model, tham số và hash ảnh để ngăn chặn double-dispatch, hỗ trợ tạo biến thể mới tường minh.
- **Cancellation-Aware**: Nhận biết tín hiệu hủy sớm ngay trong lúc đợi cấp phát tài nguyên semaphore, dọn sạch process con và tránh stale overwrite.

---

## 📦 Lịch Sử Phiên Bản: v0.7.1 (Baseline Hardening, Versioned DB Migration, OS Secret Store & Diagnostics)

Nâng cấp quan trọng theo kế hoạch kiến trúc G0 sau phân tích hệ thống Sesame Studio, hoàn thiện tính ổn định, đóng gói và bảo mật:

### 🛡️ 1. Quản Lý Bí Mật An Toàn Qua OS Secret Store (G0 Baseline)
- **Tích Hợp OS Keychain & Windows DPAPI**: Chuyển đổi toàn bộ mật khẩu proxy và Gemini API Key sang kho bảo mật hệ điều hành (`security` trên macOS, DPAPI `ProtectedData` trên Windows).
- **Loại Bỏ Plain Text & LocalStorage**: Backend đọc secret trực tiếp bằng Rust khi gọi dịch vụ cloud, không gửi secret về frontend, không lưu trong localStorage hay log nhạy cảm.

### 🔄 2. Versioned Database Migration & Auto Snapshot
- **Migration Có Phiên Bản (v1, v2...)**: Quản lý lịch sử nâng cấp schema qua bảng `schema_migrations`, đảm bảo tính idempotent và an toàn dữ liệu.
- **Auto Backup Nhất Quán (WAL-Compatible)**: Tự động chụp snapshot file `.bak` bằng `VACUUM INTO` trước khi migrate, hỗ trợ rollback transaction ngay lập tức nếu phát sinh lỗi.

### 📦 3. Độc Lập Thư Mục Chạy (Resource Path Resolution)
- **Hỗ Trợ Mở Ngoài Repo**: `PathResolver` tự động tìm tài nguyên bundle `sidecar-muse`, `sidecar-tts`, `sidecar-whiteboard` và các model ONNX/Whisper bất kể app được mở từ thư mục nào.
- **Tối Ưu Bundle**: Đóng gói chính xác các file runner cần thiết, loại trừ hoàn toàn `.venv`, cache hay `node_modules` thừa.

### 🛠️ 4. Chẩn Đoán Hệ Thống & Kiểm Tra Dependencies
- **Phân Cấp Trạng Thái Rõ Ràng**: Nhận diện chính xác giữa "tìm thấy file", "chạy được" và "đủ điều kiện dùng tính năng" (phát hiện file binary hỏng hoặc 0 byte).
- **Giao Diện Kiểm Tra Trực Quan**: Tab Cài Đặt tích hợp chức năng kiểm tra Node, Python, FFmpeg, Whisper binary, ONNX model với thông báo chi tiết tính năng bị ảnh hưởng.

---

## 📦 Lịch Sử Phiên Bản: v0.7.0 (macOS Native Support, Whiteboard Explainer Animation & 100% Offline Engine)

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
