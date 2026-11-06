# Hướng Dẫn Sử Dụng & Vận Hành Xitrum AI Studio (PoC & Production)

> **Tài liệu theo dõi và hướng dẫn sử dụng toàn diện ứng dụng desktop Xitrum AI Studio**  
> **Thư mục dự án**: `D:\Antigravity\REA\REA-project\xitrum-AI-studio`  
> **Cập nhật lần cuối**: 2026-11-06 (Phiên bản: **v0.4.0**)

---

## 1. Hướng Dẫn Khởi Chạy Ứng Dụng Nhanh (PowerShell)

Mở PowerShell và chạy chuỗi lệnh sau để khởi động chế độ phát triển (Tauri v2 Hot-Reload):

```powershell
# 1. Thêm Cargo vào biến môi trường PATH
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

# 2. Di chuyển vào thư mục dự án
cd D:\Antigravity\REA\REA-project\xitrum-AI-studio

# 3. Khởi chạy ứng dụng
npm run tauri dev
```

---

## 2. Quy Trình Vận Hành Tạo Video (Workflow Chi Tiết)

Hệ thống cung cấp **3 luồng chạy tạo video** linh hoạt:

### 🌟 Luồng 1: Luồng Mới Đỉnh Cao “Ý Tưởng → Video” (Mốc 1, Mốc 2, Mốc 3)
> *Không cần thu âm trước, không cần kịch bản dài dòng — bạn chỉ cần nhập 1 câu ý tưởng ngắn, hệ thống tự động sinh kịch bản JSON qua chatbot, tạo giọng đọc AI tiếng Việt VieNeu-TTS cho từng nhân vật, tự động phân cảnh và kết nối an toàn qua Proxy.*

```mermaid
flowchart TD
    A["1. Gõ ý tưởng ngắn\n(Ví dụ: Kể chuyện mèo con đi lạc)"] --> B["Bấm 'Sao chép Prompt'\nvà dán cho ChatGPT/Claude"]
    B --> C["Dán JSON kịch bản vào Studio\n(Tự động chia cảnh & dàn nhân vật)"]
    C --> D["Character Bible: Gán giọng VieNeu-TTS\nvà chọn ảnh khuôn mặt nhân vật"]
    D --> E["Bấm 'Tạo Giọng Đọc Tất Cả Cảnh'\n(Đo thời lượng duration_sec thật)"]
    E --> F["Duyệt kịch bản & Đẩy vào hàng đợi sinh clip (Mốc 4)"]
    F --> G["Ghép hoàn thiện: Video + Giọng đọc + BGM + Phụ đề (Mốc 5)"]
```

#### Các bước thao tác cụ thể:
1. Mở menu **✨ Ý Tưởng → Video** trên thanh điều hướng bên trái.
2. Nhập ý tưởng của bạn, chọn thể loại (Kể chuyện / Bán hàng / Giải thích / Hài hước), chọn thời lượng (15s/30s/60s/90s) và tỷ lệ khung hình.
3. Bấm **"Sao chép Prompt Chatbot"** ➜ Dán sang ChatGPT, Claude hoặc Gemini.
4. Copy toàn bộ JSON chatbot trả về ➜ Dán vào ô **"Dán kết quả JSON kịch bản"** ➜ Bấm **"Nạp Kịch Bản Vào Studio"**.
5. Chuyển sang tab **2. Character Bible & Duyệt Kịch Bản**:
   - Gán giọng đọc cho từng nhân vật (chọn trong 23 giọng dựng sẵn Bắc/Trung/Nam, bấm nút **Nghe thử**).
   - Bấm **"+ Chọn ảnh tham chiếu"** để gán ảnh khuôn mặt cố định cho nhân vật.
   - Bấm **"Tạo Giọng Đọc Tất Cả Cảnh"** để hệ thống tự động sinh audio `.wav` và đo số giây thật của từng cảnh.
   - Kiểm tra, chỉnh sửa lời thoại hoặc prompt nếu muốn ➜ Bấm **"Lưu Kịch Bản Đã Duyệt"**.
6. *(Mốc 4)* Bấm **"🚀 Duyệt & Đẩy Vào Hàng Đợi Sinh Video"** để tự động tạo toàn bộ các task Muse Video tương ứng từng cảnh, kèm ảnh khuôn mặt nhân vật và gán qua proxy an toàn.
7. *(Mốc 5)* Sau khi các cảnh sinh xong, bấm **"🎬 Xuất Video Hoàn Thiện (FFmpeg Merge)"** để tự động ghép clip, đồng bộ giọng đọc từng cảnh, phụ đề SRT và nhạc nền ducking.

---

### 🎙️ Luồng 2: Luồng Tự Động Hóa từ Âm Thanh Có Sẵn (Audio → Video Whisper Workflow)
> *Đây là luồng cốt lõi mạnh nhất của hệ thống: Biến một đoạn thu âm kịch bản thành video AI ghép nhiều phân cảnh, khớp khẩu hình/nội dung, kèm nhạc nền.*

```mermaid
flowchart TD
    A["1. Thu âm / File âm thanh (.mp3, .wav)"] --> B["Tab Phân tích âm thanh\n(Chạy Whisper STT)"]
    B --> C["Audio Timeline Editor\n(Phân rã thành từng câu thoại)"]
    C --> D["Biên tập: Sửa prompt, gán ảnh mẫu\nvà bấm 'Duyệt câu'"]
    D --> E["Bấm 'Đẩy vào hàng đợi'\n(Sinh các task Muse.ai)"]
    E --> F["Hàng đợi chạy tự động\n(Chrome CDP tải clips từ Muse.ai)"]
    F --> G["Hệ thống tự động nối clips (F12)\nvà mix nhạc nền (F13)"]
    G --> H["Video hoàn chỉnh xuất ra folder"]
```

#### Các bước thao tác cụ thể:
1. **Chuẩn bị ảnh mẫu (Tùy chọn)**:
   - Vào tab **Xóa phông (Rembg)** ➜ Chọn ảnh chân dung người mẫu ➜ Bấm thực thi để tách nền trong suốt chuẩn bị cho AI sinh video.
2. **Nạp âm thanh & Bóc tách câu thoại**:
   - Vào tab **Phân tích âm thanh** ➜ Chọn file giọng đọc (`.mp3`/`.wav`) ➜ Chọn model Whisper (ví dụ: `ggml-base` hoặc `ggml-medium`) ➜ Bấm **Bắt đầu bóc tách**.
3. **Biên tập trên Audio Timeline**:
   - Hệ thống tự động chia âm thanh thành từng câu thoại kèm mốc thời gian (`Start` - `End`).
   - Bấm nghe thử từng câu, chỉnh lại câu chữ, chọn ảnh người mẫu tham chiếu tương ứng và sửa prompt mô tả động tác/bối cảnh.
   - Bấm **Duyệt (Approve)** các câu đạt yêu cầu.
4. **Đẩy sang Hàng Đợi (Queue)**:
   - Bấm nút **"Đẩy vào hàng đợi"** ở góc trên Timeline (hoặc bấm nút "Tạo video" ở từng segment lẻ).
   - Hệ thống sẽ tạo các tác vụ sinh video Muse.ai tương ứng với từng câu thoại.
5. **Xử lý tự động (Hàng đợi đa luồng)**:
   - Runner Playwright kết nối vào Chrome thật của bạn, tự động nhập prompt, đính kèm ảnh và tải các đoạn video clip hoàn thành về máy.
   - *(Nếu có đoạn nào chưa ưng ý, bạn chỉ cần bấm nút **"Tạo lại"** (F15) riêng cho đoạn đó mà không cần làm lại từ đầu).*
6. **Ghép video & Chèn nhạc nền hoàn chỉnh (Tự động)**:
   - Khi toàn bộ các segment hoàn thành: FFmpeg tự động ghép nối tất cả các clip video lại với nhau theo đúng timeline, chèn lại track giọng nói gốc đồng bộ và tự động trộn thêm nhạc nền từ thư mục cấu hình.
   - Bấm nút **"Mở thư mục"** tại hàng đợi để lấy video thành phẩm.

---

### ⚡ Luồng 3: Tạo Video Trực Tiếp Nhanh (Tab "Tạo video")
> *Dành cho trường hợp bạn chỉ muốn tạo nhanh 1 clip video lẻ từ Prompt + Ảnh mẫu.*

1. Mở tab **Tạo video** trên menu bên trái.
2. Nhập **Prompt** (mô tả cảnh quay, hành động, ánh sáng, góc máy). Hoặc bấm chọn nhanh từ **Thư viện mẫu (Preset/Template)**.
3. Chọn **Ảnh người mẫu/Ảnh tham chiếu** (đã qua tách nền hoặc ảnh gốc).
4. Chọn **Tỷ lệ khung hình** (`16:9` ngang cho Youtube hoặc `9:16` dọc cho TikTok/Shorts/Reels).
5. Bấm **"Thêm vào hàng đợi"**.
6. Hệ thống đẩy task vào **Queue**, runner mở Muse.ai trên Chrome sinh video và tải file về máy khi hoàn thành.

---

### 🌐 Phân Hệ Quản Lý Proxy Bảo Mật & Đổi IP (Mới - Mốc 3)
> *Học hỏi từ kiến trúc Muse AI Studio: Giúp bạn chạy Muse Runner qua Proxy HTTP/SOCKS5 để tránh nghẽn mạng, đổi IP khi cần mà không lo lộ mật khẩu.*

1. Mở menu **🌐 Quản Lý Proxy** trên thanh điều hướng bên trái.
2. **Thêm Proxy hàng loạt**:
   - Dán danh sách proxy vào ô textarea (hỗ trợ các định dạng: `host:port`, `host:port:user:pass`, `scheme://user:pass@host:port`).
   - Bấm **"Thêm Vào Danh Sách"**.
3. **Kiểm tra trạng thái & Tốc độ**:
   - Bấm nút **"Test"** trên từng proxy hoặc bấm **"Kiểm Tra Tất Cả"**.
   - Hệ thống tự động kết nối thử ra internet, đo độ trễ `latency_ms` và hiển thị IP public thực tế.
   - Bấm **"Xóa Proxy Chết"** để dọn dẹp các proxy lỗi.
4. **Kích hoạt cho Muse Runner**:
   - Chọn proxy mong muốn tại menu xổ xuống **"Proxy đang gán cho Muse Runner"** (hoặc chọn *Chạy trực tiếp* nếu không dùng proxy).
   - Mật khẩu proxy được mã hóa an toàn trong SQLite, tuyệt đối không lưu plain text.

---

## 3. Các Tính Năng Đã Hoàn Thiện (v0.2.0, v0.3.0, v0.4.0)

### A. Thanh Điều Hướng Thu Gọn / Mở Rộng (Sidebar Toggle)
- Nút icon `PanelLeftClose` / `PanelLeft` nằm ngay góc trên bên trái cạnh logo.
- Bấm để thu gọn Sidebar sang dạng mini gọn gàng (72px) để tăng diện tích làm việc hoặc mở rộng ra toàn bộ.

---

### B. Quản Lý Hàng Đợi Nâng Cao (F1 – F4)
1. **📂 Mở Thư Mục Kết Quả (F1)**:
   - Xuất hiện trên cột Thao Tác khi task đạt trạng thái `success`.
   - Bấm 1 click sẽ tự động mở đúng thư mục chứa file sản phẩm xuất ra trên Windows File Explorer.
2. **🔄 Thử Lại Task Lỗi (F2 - Retry)**:
   - Khi task bị `failed`, xuất hiện nút Retry (RotateCw) để đưa task trở lại hàng đợi mà không cần gõ lại prompt.
3. **📋 Nhân Bản Task (F3 - Duplicate)**:
   - Tạo bản sao mới của task với trạng thái `queued`.
4. **✏️ Sửa Prompt Trực Tiếp (F4 - Edit Prompt)**:
   - Với các task đang chờ (`queued`), bấm biểu tượng cây bút để sửa prompt ngay trên bảng hàng đợi.

---

### C. Hệ Thống Thông Báo Nổi (F5 - Toast Notifications)
- Tự động hiển thị góc trên bên phải màn hình khi có sự kiện: thêm task, lưu template, mở folder kết quả hoặc có lỗi phát sinh.

---

### D. Thư Viện Templates & Presets (F6)
- Tab **"Thư Viện Templates"** bên thanh menu.
- Lưu lại các prompt kèm tỉ lệ khung hình (16:9, 9:16, 1:1) ưa thích.
- Bấm nút **"Áp Dụng"** để điền sẵn prompt vào form tạo video tức thì.

---

### E. Audio Timeline Segment Editor (F7 – F10)
- Nằm trong tab **"Audio Timeline Editor"**:
  1. Khi task Whisper STT bóc tách xong, hệ thống tự động phân rã vào bảng `audio_jobs` & `audio_segments`.
  2. Bảng Timeline hiển thị chi tiết mốc thời gian từng câu (phút:giây.mili-giây).
  3. **Chỉnh sửa câu chữ**: Nhấp trực tiếp vào ô câu thoại để sửa text.
  4. **Tùy biến prompt video & ảnh người mẫu**: Nhấp vào ô Prompt để nhập mô tả hoặc bấm biểu tượng máy ảnh để chọn ảnh người mẫu tham chiếu (đã tách nền từ Rembg).
  5. **Duyệt / Bỏ qua (F10)**: Nút 👍 / 👎 để duyệt hoặc loại bỏ segment trước khi dựng video.
  6. **Tạo Video Từng Câu**: Nút "Tạo Video" đẩy từng segment trực tiếp sang hàng đợi Muse.ai.
  7. **Xuất Phụ Đề & Kịch Bản (F8)**: Xuất file `.srt` chuẩn căn giờ hoặc file kịch bản `.txt`.

---

### F. Bộ Chọn Mô Hình Whisper (F9)
- Trong tab **Cài Đặt Hệ Thống**, chọn giữa:
  - `ggml-tiny` (~75MB): Siêu nhanh, nhẹ RAM.
  - `ggml-base` (~142MB): Cân bằng tốc độ và độ chuẩn.
  - `ggml-medium` (~1.5GB): Nhận dạng chính xác cao nhất.

---

### G. Muse.ai Runner Thật Qua Chrome Profile (F11)
- **Tự động hóa hoàn toàn với Playwright Core**:
  - Tự động mở Google Chrome thật với profile riêng (`D:\Antigravity\REA\REA-project\poc-phase0\chrome-profile`).
  - Giao tiếp 2 chiều stdio JSON-lines báo tiến độ: 15% → 30% → 60% → 75% → 100%.
  - Tự động đính kèm ảnh người mẫu tham chiếu nếu có.
  - Tự động download video/ảnh xuất ra về thư mục máy tính.
- **Nút "Kiểm Tra Phiên Đăng Nhập Muse.ai"**:
  - Nằm trong Cài Đặt Hệ Thống. Bấm để tự động kiểm tra xem tài khoản Muse.ai còn phiên đăng nhập hay cần đăng nhập lại.

---

### H. Render Ghép Toàn Bộ Video (F12)
- **Quy trình ghép nối hoàn chỉnh**:
  1. Khi các task video con trên Audio Timeline hoàn tất, bảng Timeline sẽ hiển thị tên file video thành phẩm trên từng hàng (`🎬 muse_xxxx.mp4`).
  2. Người dùng bấm nút **"Render Ghép Video (F12)"** trên thanh công cụ của Audio Timeline.
  3. Lõi FFmpeg Sidecar (`AudioPipeline::render_video_concat`) sẽ:
     - Tự sinh danh sách `list.txt` cho FFmpeg concat demuxer.
     - Ghép toàn bộ các đoạn video clip theo đúng trình tự thời gian.
     - Hòa trộn cùng file âm thanh thu âm gốc (chuẩn AAC 192k) với cờ `-shortest`.
     - Xuất ra video tổng hoàn chỉnh tại `D:\XitrumAI_Outputs\final_render_{job_id}.mp4`.

---

### I. Tự Động Hòa Trộn Nhạc Nền (F13 - Background Music Mixer)
- Trong tab **Cài Đặt Hệ Thống**:
  - Chọn thư mục chứa các bài nhạc nền yêu thích (`.mp3`, `.wav`, `.m4a`...).
  - Tùy chỉnh thanh trượt **Âm lượng nhạc nền** từ 5% đến 50% (mặc định 15%).
- Khi bấm **Render Ghép Video (F12)**, hệ thống sẽ tự động pick ngẫu nhiên một bản nhạc và dùng bộ lọc `amix` của FFmpeg để hòa trộn êm ái cùng giọng đọc mà không làm át tiếng nói.

---

### J. Đa Luồng Song Song & Quản Lý Tài Nguyên (F14 - Multi-Lane Runner)
- **Top Bar Badges**: Theo dõi số slot trống thời gian thực:
  - 🌐 **Muse Cloud**: Tránh gửi dồn dập nhiều yêu cầu lên cùng 1 session Muse.ai.
  - ⚡ **Local Offline**: Tối ưu số nhân CPU xử lý tách âm Whisper và xóa nền Rembg.
- Cấu hình số luồng chạy song song trong **Cài Đặt Hệ Thống** tùy thuộc vào cấu hình máy tính của bạn.

---

### K. Tạo Lại Video Cho Từng Câu Thoại (F15 - Regenerate Segment)
- Nếu đoạn video AI sinh ra cho một câu thoại chưa vừa ý:
  - Trên bảng **Audio Timeline Editor**, hàng câu thoại đó sẽ có nút **"Tạo Lại (F15)"** (icon `RotateCcw`).
  - Chỉ cần bấm 1 click: hệ thống sẽ xóa liên kết video cũ và tự động đưa đoạn câu thoại đó vào hàng đợi để Muse.ai sinh một phiên bản video mới.

---

## 3. Thư Viện File Portable & Môi Trường

Tất cả sidecars đã được tích hợp sẵn trong ứng dụng, người dùng không cần cài thêm công cụ bên ngoài:
- **FFmpeg Sidecar**: `src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe`
- **Whisper Sidecar**: `src-tauri/binaries/whisper-cli-x86_64-pc-windows-msvc.exe` kèm toàn bộ DLLs runtime.
- **Mô hình AI Rembg**: `src-tauri/resources/u2netp.onnx` (~4.5 MB, inference siêu tốc ~0.2s).
- **Chrome Profile**: `poc-phase0/chrome-profile` lưu vĩnh viễn cookies và đăng nhập Muse.ai.
- **Database**: SQLite lưu tại `%TEMP%\xitrum_ai.db` (tránh reload watcher khi chạy chế độ dev).

---

## 4. Lệnh Đóng Gói Bộ Cài Đặt Release (Khi Hoàn Tất Mọi Tính Năng)

Khi đã sẵn sàng xuất bản phiên bản mới, chạy lệnh sau trong PowerShell:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd D:\Antigravity\REA\REA-project\xitrum-AI-studio
npm run tauri build
```

File cài đặt setup Windows hoàn chỉnh (`.exe` NSIS và `.msi`) sẽ được xuất ra tại thư mục:  
`src-tauri/target/release/bundle/nsis/`
