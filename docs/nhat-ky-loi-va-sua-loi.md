# Nhật Ký Lỗi & Giải Pháp Xử Lý (Bug & Fix Log)

> **Dự án**: Xitrum AI Studio (Porting Kahi AI sang Tauri v2 + Rust)  
> **Thư mục dự án**: `D:\Antigravity\REA\REA-project\xitrum-AI-studio`  
> **Cập nhật ngày**: 2026-11-06

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


---

## 5. Lỗi: Muse runner crash với thông báo "Cannot read properties of undefined (reading 'slice')"

- **Thời điểm**: 2026-11-06 (Chạy tác vụ sinh MuseVideo / MuseImage từ hàng đợi).
- **Hiện tượng**:
  Khi tác vụ `MuseVideo` bắt đầu chạy, tiến trình Node.js runner kết thúc đột ngột và log tại `%TEMP%\xitrum_debug.log` báo:
  ```text
  ERROR xitrum_ai_studio_lib::queue: Muse execution failed: Muse runner error: Cannot read properties of undefined (reading 'slice')
  ```
- **Nguyên nhân gốc rễ**:
  Lệch chuẩn định dạng khóa (naming convention mismatch) giữa Rust và Node.js:
  - Trong `src-tauri/src/executors/muse_runner.rs`, enum `RunnerCommand` được cấu hình `#[serde(rename_all = "snake_case")]`. Khi Rust serialize lệnh `Generate` sang JSON gửi qua stdin cho Node.js, các key được tạo theo dạng snake_case: `task_id`, `input_path`, `output_dir`, `user_data_dir`.
  - Phía script `sidecar-muse/runner.mjs` lại destructure trực tiếp theo chuẩn camelCase:
    ```javascript
    const { taskId, prompt, ratio, kind, inputPath, outputDir, userDataDir } = cmd;
    ```
  - Do đó `taskId` nhận giá trị `undefined`, dẫn đến việc gọi `taskId.slice(0, 8)` gây ra ngoại lệ (TypeError) làm runner dừng hoạt động.
- **Phương án khắc phục triệt để**:
  1. **Phía Rust (`src-tauri/src/executors/muse_runner.rs`)**:
     - Định cấu hình `#[serde(rename = "...")]` tường minh theo chuẩn `camelCase` cho toàn bộ các trường của `RunnerCommand` (`taskId`, `inputPath`, `outputDir`, `userDataDir`).
     - Với `RunnerMessage` (chiều nhận từ Node.js về Rust), bổ sung `#[serde(alias = "...")]` để Rust chấp nhận linh hoạt cả 2 định dạng `camelCase` lẫn `snake_case`.
  2. **Phía Node.js (`sidecar-muse/runner.mjs`)**:
     - Sử dụng toán tử nullish coalescing (`??`) để đảm bảo dự phòng nhận cả hai format:
       ```javascript
       const taskId      = cmd.taskId      ?? cmd.task_id;
       const inputPath   = cmd.inputPath   ?? cmd.input_path;
       const outputDir   = cmd.outputDir   ?? cmd.output_dir;
       const userDataDir = cmd.userDataDir ?? cmd.user_data_dir;
       ```

---

## 6. Lỗi: Đóng trình duyệt Chrome thủ công khiến các tác vụ sau bị lỗi "Target page, context or browser has been closed"

- **Thời điểm**: 2026-11-06 (Khi người dùng vô tình hoặc chủ động tắt cửa sổ Chrome do Runner mở ra).
- **Hiện tượng**:
  Khi tắt cửa sổ trình duyệt Chrome, nếu tiếp tục bấm "Thêm vào hàng đợi" hoặc bấm "Kiểm tra phiên đăng nhập" (Refresh Session), hệ thống lập tức báo lỗi đỏ:
  ```text
  ERROR: Muse runner error: page.goto: Target page, context or browser has been closed
  ```
  hoặc
  ```text
  ERROR: Muse runner error: page.screenshot: Target page, context or browser has been closed
  ```
- **Nguyên nhân gốc rễ**:
  - Script `sidecar-muse/runner.mjs` khởi tạo biến toàn cục `browserContext` và `page` dạng singleton.
  - Ban đầu, hàm `getOrCreatePage` chỉ kiểm tra `if (!browserContext)`, nếu biến này đã được gán trước đó thì nó tái sử dụng luôn `browserContext` và `page` cũ.
  - Khi người dùng đóng cửa sổ Chrome trên Windows, Playwright Context/Page đã bị đóng (`isClosed()` / `!isConnected()`), nhưng tham chiếu biến trong Node.js vẫn còn tồn tại. Do đó các lệnh tiếp theo (`p.goto(...)`, `p.screenshot(...)`) gọi vào page đã chết và văng ngoại lệ ngay lập tức.
  - Đồng thời, phía Rust `MuseRunner` giữ tiến trình Node runner ngầm và không phát hiện nếu tiến trình này bị đơ hoặc đã thoát.
- **Phương án khắc phục**:
  1. **Trong `sidecar-muse/runner.mjs`**:
     - Thêm kiểm tra trạng thái sống của `browserContext`:
       ```javascript
       if (browserContext) {
         try {
           if (!browserContext.isConnected()) {
             browserContext = null;
             page = null;
           }
         } catch {
           browserContext = null;
           page = null;
         }
       }
       ```
     - Lắng nghe sự kiện `browserContext.on("close")` và `page.on("close")` để tự động reset các biến về `null`.
     - Trong `getOrCreatePage()`, nếu `page` bị đóng hoặc không còn page nào hợp lệ, tự động gọi `await browserContext.newPage()` hoặc khởi chạy lại context mới.
     - Khi xảy ra lỗi hoặc timeout, chỉ gọi `screenshot` nếu `p && !p.isClosed()`.
  2. **Trong `src-tauri/src/executors/muse_runner.rs`**:
     - Bổ sung kiểm tra `child.try_wait()` trong `ensure_started()`. Nếu tiến trình Node sidecar đã kết thúc trước đó, tự động dọn dẹp và spawn tiến trình mới.
     - Bổ sung hàm `reset()` để kill tiến trình cũ khi cần thiết.

---

## 7. Tổng hợp xử lý toàn diện các lỗi chặn chạy (B1-B6), lỗi logic kết quả (S1-S11), bảo mật (R1-R5) và đồng bộ v0.6.0

- **Thời điểm**: 2026-11-06 (Tổng rà soát chất lượng & Production readiness).
- **Các nhóm lỗi và giải pháp thực hiện**:
  1. **B1 & S11 (Lệch giao thức Rust - Node.js)**:
     - Thống nhất phía `runner.mjs` phát tin type `"success"` kèm các alias `output_path`, `outputPath`, `taskId`. Phía Rust `RunnerMessage::Success` bổ sung alias `task_complete`, `outputFile`, `output_file`.
     - Thống nhất báo lỗi với cả trường `error` và `message`. Khai báo `cmd` bên ngoài khối `try` để tránh lỗi kép khi parse JSON.
  2. **B2 (Thiếu thư viện playwright-core)**:
     - Thêm `playwright-core` vào `package.json` và cài đặt vào môi trường dự án.
  3. **B3 & B6 (Đường dẫn cứng máy tác giả)**:
     - Trong `muse_runner.rs`: dò tìm file `sidecar-muse/runner.mjs` tương đối theo thư mục ứng dụng (tương tự như `tts.rs`).
     - Trong `queue.rs`: nạp model `u2netp.onnx` từ thư mục `resources/` tương đối; đường dẫn lưu kết quả lấy động từ cấu hình SQLite `config.output_dir`.
     - Trong `audio.rs`: tìm model Whisper `ggml-tiny.bin` từ thư mục `resources/` tương đối.
     - Trong `App.tsx`: xóa toàn bộ đường dẫn ghi cứng ổ `D:`.
  4. **B4 & B5 (Kiểm tra và cấu hình sidecars & VieNeu-TTS)**:
     - Xác nhận và bổ sung model `ggml-tiny.bin` vào `src-tauri/resources/`.
     - Thêm file `sidecar-tts/requirements.txt` và cập nhật README hướng dẫn cài đặt `vieneu`.
     - S2: Trong `tts_runner.py`, trả về lỗi rõ ràng yêu cầu cài `vieneu` thay vì sinh tiếng bíp 440 Hz giả mạo.
  5. **S1 & S3 (Tránh ghi file rỗng hoặc chụp màn hình lỗi)**:
     - Trong `runner.mjs`, ném lỗi nếu URL video/ảnh không hợp lệ hoặc dữ liệu trả về rỗng, ngăn chặn ghi file rỗng và ngăn chụp màn hình trang web làm ảnh thành phẩm.
  6. **S4 (Giải mã mật khẩu Proxy)**:
     - Trong `queue.rs`, giải mã mật khẩu proxy đã mã hóa trước khi truyền cấu hình sang `muse_runner`.
  7. **S5, S6, S10 (Chuẩn hóa Hậu kỳ FFmpeg)**:
     - S5: Thay thế `amix` bằng `sidechaincompress` trong filter complex để thực hiện Audio Ducking thực thụ (hạ nhạc nền khi có giọng TTS).
     - S6: Thay cờ `-c copy` khi ghép cảnh bằng re-encoding chuẩn hóa (`-c:v libx264 -pix_fmt yuv420p -r 30`) để tránh hỏng video do lệch codec/fps giữa các cảnh Muse.
     - S10: Sắp xếp danh sách file nhạc nền theo thứ tự bảng chữ cái để chọn bài ổn định.
  8. **S7 & R3 (Bảo toàn dữ liệu & Toàn vẹn SQLite)**:
     - Kích hoạt `PRAGMA foreign_keys = ON;` khi mở kết nối Database.
     - Hàm `delete_script_project` thực thi trong 1 transaction xóa sạch cả 3 bảng `script_scenes`, `characters`, `scripts`.
     - R3: Chuyển vị trí lưu `xitrum_ai.db` sang thư mục dữ liệu ứng dụng (`app_local_data_dir`) thay vì thư mục tạm (`temp_dir`).
  9. **S8 (Validation kịch bản JSON & ánh xạ giọng)**:
     - Kiểm tra bắt buộc có ít nhất 1 cảnh, thời lượng > 0 giây, không trùng số thứ tự cảnh, có thoại hoặc visual prompt.
     - Ánh xạ giọng đọc thông minh phân biệt cả giới tính và nhóm tuổi (trẻ em / người lớn).
  10. **S9 & R2 (Hủy task & kiểm soát hạn mức RPA)**:
      - Khi người dùng bấm hủy task trong Rust, thực hiện `self.reset()` để dừng ngay tiến trình Node và đóng trình duyệt.
      - Trong `runner.mjs`, kiểm tra tức thì các dấu hiệu Captcha, Rate Limit, Hết Credit sau khi gửi prompt.
  11. **R4 & D1-D5 (Dọn dẹp bảo mật, phiên bản và tài liệu)**:
      - Đổi tên ứng dụng trong `capabilities/default.json` thành "Xitrum AI Studio".
      - Đồng bộ toàn bộ badge phiên bản và tài liệu vận hành lên `v0.6.0`.
      - Bổ sung `LICENSE` (MIT) và `.env.example`.
