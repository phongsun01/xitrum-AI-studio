# Rà soát UI và pipeline media — Sesame Studio 1.0.0

Phạm vi: phân tích tĩnh các file trích xuất trong `extracted/resources/app`, không chạy ứng dụng, không gọi API, không thực thi Python/FFmpeg/yt-dlp đi kèm. Các vị trí dưới đây là đường dẫn tương đối tính từ thư mục đó. Đây là bằng chứng đọc mã nguồn bằng công cụ shell, không tự nhận là REA Evidence.

## 1. Bản đồ giao diện và điểm nối backend

`ui/index.html:50–62` khai báo các tab Studio, Tư liệu, Kịch bản, Prompt đồng bộ, Thư viện, Edit/Ghép, Cắt video, Text to Speech, Đăng Reels, Tài khoản, Cài đặt, Hướng dẫn. Ngoài ra có các section Flow (`:184`), Ladipage (`:788`), API (`:1522`); section tồn tại không chứng minh mọi luồng đều hiển thị mặc định. `main.js:482` đăng ký nhóm `ipc-features`, và `main.js:1290–1459` đăng ký toolkit/cắt/edit/TTS. `preload.js:147–176` phơi các wrapper IPC tương ứng.

Đường đi Cắt video được nối cụ thể: `ui/toolkit-tools.js:148` gọi `toolkitProbeVideo`, `:555` gọi detect-scenes, `:760` gọi cut-export, `:817` gọi merge-cuts; qua `preload.js:150–154` đến `main.js:1316–1347` và `engine/toolkit/toolkit-cut.js`.

## 2. Cắt, nối, chỉnh sửa video

- **Chia video:** `toolkit-cut.js:179–228` dùng FFmpeg `select=gt(scene,threshold),showinfo` để tìm chuyển cảnh; ngưỡng được chặn 0.08–0.9. Đây là phép đo thay đổi hình ảnh bằng FFmpeg, không phải bằng chứng có mô hình nhận diện nội dung. `:234` lập kế hoạch theo số phần/thời lượng/mốc/cảnh; `:416–480` chọn chế độ. Khi chỉ cắt thì dò keyframe, căn mốc và stream-copy; khi có chỉnh hình/tốc độ/âm lượng thì encode lại. Nếu thiếu mốc/keyframe/chuyển cảnh, backend trả lỗi cụ thể thay vì tự sinh mốc giả.
- **Biến đổi:** `toolkit-cut.js:330–388` tạo FFmpeg arguments cho lật/xoay, scale-pad tỉ lệ 9:16, 16:9, 1:1; đổi `setpts` và `atempo`, rồi H.264/AAC. `:483–492` đặt thư mục đầu ra và thêm hậu tố tránh trùng.
- **Nối video:** `engine/merge.js:48–94` ghi concat-list, đo duration và stream metadata; nếu khác fps/timebase/kích thước thì reencode, còn trường hợp phù hợp có thể `-c copy`. Khi normalize, code đặt 30 fps, loudnorm, AAC 44.1 kHz. `:184–192` wrapper mặc định normalize=true.
- **Biên tập nhiều track:** `engine/video-editor.js:27–41` định nghĩa project JSON chứa clips, music, dub, texts, overlays, masks, audioSegs, watermark, SRT. `:81–92` lưu project và ảnh cover. `:129–159` gọi planner, ghi `graph.txt` rồi chạy FFmpeg với `-filter_complex_script`, map `[vout]`/`[aout]`, xuất H.264/AAC. `video-editor-plan.js:35–45` định nghĩa transition và filter màu; `:52–66` trừ phần chồng chuyển cảnh khỏi duration. Đây là pipeline filter FFmpeg chứ không phải engine edit độc lập.
- **Nhạc nền:** `merge.js:107–130` tìm nhạc bằng tên đường dẫn/alias mood; `:138–156` tạo sidechaincompress/amix và fade. Nhãn “theo cảm xúc” ở đây dựa khớp chuỗi, không chứng minh phân loại âm nhạc bằng AI.
- **Encoder:** `engine/h264.js:9–10,22–54` dò `ffmpeg -encoders`, ưu tiên libx264, libopenh264, NVENC, AMF, MF, QSV; trả CRF/preset chỉ cho libx264, encoder khác dùng bitrate. Không suy từ comment rằng mọi encoder hoặc bộ binary đều chạy được trên máy hiện tại.

## 3. TTS và lồng tiếng

Catalog thực tế tại `engine/toolkit/tts-sources.js:149–170` triển khai Edge (online), Google Translate TTS (online) và VieNeu (local). Piper, Kokoro, CapCut, FPT, Vbee, ElevenLabs được trả `available:false`; logo hoặc tên module `toolkit-capcut-tts` không có nghĩa backend CapCut được tích hợp.

Google TTS: `tts-sources.js:45–105` chia văn bản khoảng 170 ký tự, GET `translate.google.com/translate_tts`, retry và ghép MP3 qua FFmpeg stdin. Edge: `:126–145` lấy catalog bằng Python `edge_tts.list_voices`, cache 7 ngày, có danh sách rút gọn khi lỗi; `:174–210` chọn nguồn và retry Edge tối đa 5 lần. `engine/edge_tts_cli.py:4–9` dùng `edge_tts.Communicate(...).save(...)`. VieNeu: `engine/vieneu_tts_cli.py:8,61–79` tạo `Vieneu()`, infer theo giọng, save audio và đóng model; một batch dùng cùng instance. Chưa kiểm tra model/cache có sẵn hoặc tải model lúc khởi tạo trong thư viện ngoài.

Đường đi TTS UI: `ui/toolkit-tools.js:887,1000,1427` gọi catalog/preview/generate; `main.js:1449–1459` chuyển sang toolkit. `toolkit-capcut-tts.js:409–460` nhận text/TXT/SRT và chế độ giữ timeline/fit/pro; `:491–513` tăng tốc câu dài theo giới hạn rồi ghi cảnh báo nếu còn vượt ô, không cắt chữ trong nhánh này; `:518–544` dùng adelay/amix và xuất WAV/MP3/M4A. Chế độ văn xuôi `:581–643` tạo khoảng nghỉ, tổng hợp từng câu, cắt khoảng lặng hai đầu, concat và loudnorm.

Có **pipeline dub khác** ở `engine/ipc-dub.js:97–194`: synth từng cue, time-sync tối đa 1.6x, nếu còn dài thì atrim/fade để khớp ô, rồi adelay/amix. Do đó không thể tuyên bố mọi chế độ lồng tiếng đều bảo toàn toàn bộ từ; nhánh dub có thể cắt đuôi câu (`:137–177`).

`engine/scene-compose.js:24–32` chọn thời lượng cảnh tối thiểu 3 giây, lời đọc +0.45 giây, làm chậm tối đa 1.25 rồi freeze frame nếu cần. `:190–226` gom narration/dialogue đa giọng, `:255–286` dựng từng cảnh và trộn ambient, `:309–326` concat rồi burn ASS subtitles/loudnorm. Đồng bộ phụ đề dựa silence detection/chia cụm (`:301–303`), chưa phải bằng chứng forced alignment theo từng từ.

## 4. Dịch phụ đề, review và mức độ triển khai thực tế

`engine/ipc-features.js:110–131` tách giọng/nhạc bằng cộng/trừ kênh stereo + highpass/lowpass; file mono bị từ chối. Đây là triệt/giữ kênh giữa, không phải Demucs hay source separation AI.

`toolkit-translator.js:123–139` có chế độ local_rules; `:161–184` gọi Gemini `gemini-1.5-flash` hoặc OpenAI chat completions; `:201–204` báo lỗi nếu vẫn còn chữ Hán. Đây là model/endpoint ghi trong bản phát hành, chưa xác minh còn được dịch vụ hỗ trợ. `engine/ipc-review.js:57–88` yêu cầu SRT + API key, nhóm cue, gọi LLM theo batch 12, viết lời bình và giữ mốc; không tự xem hình ảnh video. `:29–50` có chọn Gemini model từ danh sách trả về hoặc OpenAI `gpt-4o-mini`.

Module có tên OCR **không chứa OCR/ASR trong phạm vi đã đọc**: `toolkit-ocr.js:19–43` chỉ tách audio WAV PCM 16 kHz mono; `:49–78` tạo slot thời gian bằng interval cố định với text `[Câu thoại #n]`. Không có gọi nhận diện ký tự/giọng nói trong module; `main.js:1429` chỉ nối API extract-audio. Không được coi placeholder này là phụ đề đã nhận diện.

## 5. Điểm bất thường: downloader có fallback video không khớp URL

`engine/ipc-tools.js:172–192` thử yt-dlp với URL HTTP(S), deadline 45 giây, output MP4; sáu mẫu ID bị bỏ qua yt-dlp ở `:180`. Nếu tải thất bại hoặc link mẫu, `:195–216` quét sáu tên video cố định trong output, chọn ngẫu nhiên một file có sẵn >2 MB, copy sang tên `Clean_...mp4`, trả `{ok:true, method:'clean-stream'}`. Hai channel `feat:download-url` và `feat:hg-download-url` cùng dùng handler (`:222–223`).

**Quan sát:** nhánh code này không tải nội dung từ URL mà sao chép file local. **Suy luận:** nếu các file mẫu đó hiện diện, UI có thể nhận kết quả thành công với nội dung không liên quan URL. **Chưa biết:** nhánh này có được chạy trên máy người dùng thực tế hay không; archive inventory không thấy các video mẫu được ship sẵn, nhưng chúng có thể tồn tại trong thư mục output người dùng. Nếu không tìm thấy, code trả lỗi ở `:219`.

## 6. Đăng Facebook Reels và phụ thuộc nền tảng

`main.js:1108` gọi `fbPoster.publishFacebookReels`; `engine/facebook-poster.js:124–187` kiểm tra file, POST tạo phiên `/{pageId}/video_reels`, upload binary tới URL server trả về bằng OAuth token, POST `upload_phase=finish&video_state=PUBLISHED`. Đây là luồng đăng bài thật được viết trong mã; chưa gọi API nên không xác nhận quyền token, quota hoặc tương thích Graph v20.0.

Bản này hướng Windows rõ rệt: Python candidate hard-code `.exe`/AppData (`ipc-tools.js:15–23`); font trong edit planner lấy `C:/Windows/Fonts` (`video-editor-plan.js:11–28`); một số toolkit resolver tìm `ffmpeg.exe` (`toolkit-ocr.js:5–13`). `merge.resolveBin` có nhánh macOS và tìm Homebrew (`merge.js:171–181`), nhưng điều đó không làm gói Windows thành app macOS hoàn chỉnh. Dependency Python `edge-tts`, `yt-dlp`, `vieneu` được cài bằng pip theo hành động IPC (`ipc-tools.js:225–239`); không có bằng chứng chúng đã sẵn sàng chỉ từ file installer.

## Giới hạn

Đã đọc trực tiếp các luồng nêu trên, chưa kiểm thử runtime hay UI screenshot, chưa benchmark chất lượng encode/TTS, chưa xác minh tình trạng các dịch vụ bên ngoài. Không kiểm toán native DLL/EXE, mọi nhánh UI, và thư viện Python ngoài gói. Không thể kết luận tính hoàn chỉnh của sản phẩm hoặc độ tin cậy của kết quả chỉ dựa tên nút và comment.
