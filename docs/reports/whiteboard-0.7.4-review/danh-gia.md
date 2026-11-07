# Đánh giá Whiteboard 0.7.4 sau triển khai

Ngày: 07/11/2026. Mã được đọc: HEAD `c7eaba6`; workspace có asset `quill-pen.png` chưa được Git theo dõi trước review. Không sửa mã sản phẩm trong lần đánh giá này.

## Kết luận

Đã tiến bộ rõ về chức năng: quản lý nhiều cảnh, TTS theo SRT, render có audio, lựa chọn nét/tô, chỉnh annotation, preview và encode H.264 trực tiếp. Build và test hiện có đều qua. Chưa nên nghiệm thu toàn bộ kế hoạch: vẫn còn lỗi làm chồng lời đọc, lệch nội dung hình so với master audio sau chỉnh cảnh, bỏ audio không tồn tại và các phần chất lượng hình/cache chưa hoạt động đúng hợp đồng.

Không chấm điểm số chủ quan thay cho bằng chứng. Độ đúng của frame cuối tốt trên mẫu đã đo; khả năng dàn dựng theo nội dung và tính đúng ở các đường biên còn hạn chế.

## Phạm vi kiểm tra và kết quả

- `npm run build`: đạt; có cảnh báo import động/tĩnh plugin-dialog không ảnh hưởng kết quả build.
- `sidecar-whiteboard/.venv/bin/python -m unittest discover -s sidecar-whiteboard/tests -v`: **47/47 đạt**, có ResourceWarning về các file/pipe chưa đóng.
- `cargo test whiteboard --lib -- --nocapture`: **8/8 đạt**, 6 test khác bị filter theo tên.
- Phân tích lại ba ảnh vườn đào bằng generator hiện tại: **[1, 1, 1] vùng**. Vẫn gộp cả ảnh thành một vùng; chưa chia riêng Lưu Bị/Quan Vũ/Trương Phi hoặc đồ lễ theo lời kể.
- Render mới cảnh 1 bằng skeleton, lần lượt contour-wipe/brush/palette-brush, cạnh dài 640px, 8fps, 30 giây, tắt tay để đo độ phủ. Mỗi lượt khoảng **3,9–4,1 giây** trên máy hiện tại. Không phải benchmark so sánh bản cũ hoặc cam kết tốc độ ở 1080p/30fps.
- So sánh canvas cuối trước encode với nguồn đã chuẩn hóa: 98.718 pixel nội dung, **0 pixel sai lệch trên 35 mức màu BGR** ở cả ba kiểu. Chỉ xác nhận mẫu cảnh 1/cấu hình này; không chứng minh mọi ảnh đều được phủ đầy.
- Đã xem [contact sheet](contact-sheet.jpg): ảnh cuối đầy đủ, nét trung gian còn vụn ở một số đoạn; đến 24 giây vẫn chủ yếu là nét và màu xuất hiện gần cuối. Đây là kết quả adaptive budget của ca mẫu, không phải lỗi mất màu.
- Probe output cũ: `input_images/ket-nghia-vuon-dao/Untitled.mp4` là video-only 90 giây; `output/Untitled.mp4` có video 90 giây/audio 91 giây; `output/Ket_Nghia_Vuon_Dao_Whiteboard_Full.mp4` có H.264/AAC đều 90 giây. Những file này tạo trước lần review, không dùng để khẳng định hành vi của mọi nhánh mã hiện tại.

Giới hạn: chưa kiểm thử UI Tauri bằng thao tác trực tiếp, chưa kiểm thử bản installer, chưa chạy lại model TTS hoặc nghe chấm chất giọng. Repro TTS bên dưới kiểm tra bộ ghép bằng waveform giả lập, không xác nhận chất lượng phát âm của VieNeu. Không đánh giá bàn tay từ bản render mới vì đã tắt tay để tách phép đo độ phủ.

## Phát hiện cần sửa

### F1 — P1: TTS từ SRT có thể làm hai câu nói chồng nhau

Vị trí: `sidecar-tts/tts_runner.py:175–184`.

Mỗi câu được đặt vào timestamp bắt đầu bằng phép cộng waveform. `end_ms` không giới hạn hoặc kiểm tra độ dài đoạn `tts.infer` trả về. Nếu câu dài hơn cửa sổ SRT và cue kế tiếp bắt đầu, cả hai giọng được cộng lên nhau; normalize cuối chỉ giảm clipping, không giải quyết chồng lời.

Repro dùng đúng hàm `generate_srt_tts`, thay infer bằng waveform 3 giây, hai cue cách nhau 2 giây: mức đơn 0,2; vùng chồng 2–3 giây có mức 0,4. Không cần chạy model để chứng minh lỗi bộ ghép.

Đề nghị: kiểm tra duration từng câu; báo overflow hoặc áp dụng chính sách retime/tốc độ có giới hạn rồi cập nhật SRT/timeline nhất quán. Không cắt đuôi lời hoặc cộng hai câu như mixer nhạc. Thêm test cue overflow, không chỉ kiểm tra output có audio stream.

### F2 — P1: Đổi thứ tự/duration cảnh không ánh xạ lại master audio

Vị trí: `src/components/WhiteboardEditor.tsx:300–309`, `src-tauri/src/commands.rs:1854–2000`.

UI cho đổi thứ tự cảnh và sửa duration. Export tuần tự theo mảng `project.scenes`, nhưng master audio vẫn được mux nguyên bài ở cuối. Không có kiểm tra các trường timelineStartMs/timelineEndMs còn khớp thứ tự/duration, cũng không có mapping audio nguồn theo cảnh.

Ví dụ: master kể A rồi B, người dùng chuyển cảnh B lên trước. Video xuất B rồi A, tiếng vẫn A rồi B; lệnh vẫn báo thành công. Sửa độ dài cảnh đầu cũng làm các cảnh sau lệch lời.

Đề nghị: khóa/chặn xuất khi master timeline mâu thuẫn hoặc bổ sung chế độ bố cục tự do với audio source interval cho từng cảnh. Test ở đường export project, không chỉ test parser chia SRT.

### F3 — P1: Audio đã chọn nhưng không tồn tại vẫn xuất thành công không tiếng

Vị trí: `sidecar-whiteboard/whiteboard_runner.py:443–448` và `543–556`.

Điều kiện `audio_path and os.path.exists(...)` hoặc master tương tự chỉ quyết định có mux hay không. Khi đường dẫn được cung cấp nhưng file mất, runner âm thầm bỏ qua và trả output thành công. Kiểm tra audio phía UI không thay được validation ở runner, đặc biệt với per-scene audio hoặc file bị xóa sau kiểm tra.

Repro đã gọi thật cả render cảnh và merge master với `/tmp/xitrum-whiteboard-review/does-not-exist.wav`: cả hai đều thành công, output không có lời đọc yêu cầu.

Đề nghị: phân biệt audio không được chọn với audio được chọn nhưng lỗi; validate tồn tại, đọc được và có audio stream trước render/mux. Chỉ xuất không tiếng khi project chủ động chọn chế độ đó.

### F4 — P2: Resume dự án không tìm thấy manifest; fingerprint chưa chuẩn hóa thống nhất

Vị trí: `src-tauri/src/commands.rs:1954–1972`, `sidecar-whiteboard/whiteboard_runner.py:500–519` và `599–614`.

Runner nhận output `scene.mp4.part.mp4` và ghi manifest cạnh tên đó. Rust chỉ rename video sang `scene.mp4`; manifest không đi theo. Lần resume tìm `scene.mp4.manifest.json`, không thấy và render lại.

Một nguyên nhân độc lập: fingerprint lúc render dùng hand path đã resolve thành asset tuyệt đối và style đã resolve, còn get_fingerprint dùng tham số gốc (ví dụ `drawing-hand.png`/None). Cùng tác vụ có thể hash khác nhau ngay cả khi di chuyển manifest.

Repro mô phỏng đúng part→final: manifest chỉ tồn tại ở tên part, verify_cache=false; request fingerprint khác fingerprint ghi sau render.

Đề nghị: tính effective settings một lần và dùng cho cả lookup/write; công bố video+manifest dưới tên cuối sau probe. Kiểm thử xuyên đường project thay vì chỉ kiểm tra helper ghi/đọc manifest tại cùng tên.

### F5 — P2: Palette-brush vẫn reveal sang nhóm màu chưa tới lượt

Vị trí: `sidecar-whiteboard/scripts/render_stream_whiteboard.py:338–351`.

Renderer gom điểm của mọi cluster thành một list, sau đó gọi `_wash_brush(..., allowed)` với mask của toàn element. Footprint cọ không bị giới hạn bởi mask cluster hiện tại. Một điểm thuộc nhóm đỏ có thể reveal màu xanh cạnh nó trước lượt nhóm xanh; thứ tự nhóm màu/subject-first không được bảo toàn ở mức pixel.

Repro cố định hai cluster kề nhau để loại trừ nhiễu kmeans: ngay frame đầu của nhóm đầu có **323 pixel thuộc nhóm kế tiếp** đã hiện. Màu cuối vẫn đúng vì renderer chép màu nguồn; đây là lỗi thứ tự reveal, không phải tô sai màu cuối.

Đề nghị: giữ cluster ID/mask trong plan, stamp với `allowed & cluster.mask` và xử lý biên mực rõ ràng. Thêm test pixel reveal theo từng nhóm thay vì chỉ test tâm cọ nằm trong cluster.

### F6 — P2: Pixel ownership của vùng lồng nhau chưa độc quyền

Vị trí: `sidecar-whiteboard/scripts/whiteboard_render_plan.py:124–135`.

Vùng cha chỉ bị trừ phần ruột vùng con, nhưng vùng con vẫn sở hữu toàn bbox. Dải margin quanh bbox con thuộc cả cha lẫn con. `owner_map` được khởi tạo nhưng chưa được dùng để đảm bảo độc quyền.

Repro outer 100×100, inner bbox 60×60: hai mask cùng sở hữu **684 pixel**. Với nét/chữ ở dải này, nội dung cue sau có thể hiện trong lượt vùng cha.

Đề nghị: phân quyền component/mask thật; nếu cần giữ viền container thì chỉ giữ pixel viền container đã xác định. Test tổng quyền sở hữu mỗi pixel <=1 và thứ tự xuất hiện theo cue.

## Khoảng cách với kế hoạch

- Chưa thấy styleMode/randomSeed/resolved random style trong UI/types/RPC: chọn kiểu hiện có, nhưng chưa thể nghiệm thu random ổn định theo cảnh.
- `build_element_timeline_plan` có unit test nhưng đường render chính vẫn dùng samples/pen_lifts với `_frame_progress_indices`, không tiêu thụ các contact time float từ plan. Vì vậy test helper pen-up chưa xác nhận chuyển động tay thật trên toàn renderer.
- `subject-first` có CLI flag nhưng chưa truyền xuyên UI/RPC; bộ tách vùng là heuristic OpenCV, chưa có CRAFT trong đường hiện tại.
- `mux_video_and_audio` giữ đuôi video khi audio dài hơn >=300ms, nhưng nhánh audio ngắn chưa thực hiện apad như docstring mô tả.
- Merge chưa có bước probe/chuẩn hóa tất cả stream trước concat; `-c copy` thành công không chứng minh mọi cảnh khác resolution/audio layout đã được chuẩn hóa.
- Encoder có rename output nguyên tử, nhưng không probe trước công bố; comment “xác thực bằng ffprobe” chưa tương ứng với đường release hiện tại.

## Ưu tiên tiếp theo

1. Sửa F1–F3 để bảo toàn lời đọc và quan hệ hình–tiếng.
2. Sửa F4 để resume thật sự hoạt động; thêm integration test qua quy trình part→final.
3. Sửa F5–F6 và nối contact plan vào renderer; sau đó duyệt video có bàn tay.
4. Tinh chỉnh segmentation trên chính ba ảnh vườn đào, sau đó mới mở random/subject-first làm mặc định.
5. Kiểm thử native UI/bundle và bộ ảnh đa dạng trước tuyên bố hoàn tất R0–R7.

## Bằng chứng và cách chạy lại

- [Kết quả máy đọc được](results.json).
- [Script render và tái hiện audio/cache/ownership](check_quality.py).
- [Script TTS mixer fixture, palette fixture và contact sheet](check_extra.py).
- [Contour-wipe](contour-wipe.mp4), [brush](brush.mp4), [palette-brush](palette-brush.mp4).

Các script review dùng `/tmp/xitrum-whiteboard-review` để giữ đầu ra, chạy từ thư mục gốc repo bằng `.venv` whiteboard; không ghi đè ảnh/audio/video gốc. `check_quality.py` cố ý tái hiện các đường đang lỗi và không có assertion biến chúng thành test pass. `check_extra.py` dùng inference/cluster fixture có kiểm soát cho các phép đo cụ thể; không giả vờ đã chạy model TTS thật.
