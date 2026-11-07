# Kế hoạch nâng cấp Whiteboard của Xitrum AI Studio

Ngày lập: **07/11/2026**. Baseline: workspace hiện tại, `package.json` **0.7.1**.
Trạng thái: **kế hoạch triển khai; tài liệu này không xác nhận các tính năng đề xuất đã được làm**.

## 1. Mục tiêu và phạm vi

Tạo video whiteboard nhiều cảnh từ ảnh, audio và SRT: mỗi cảnh có ảnh riêng, thứ tự vùng, thời gian, kiểu nét, kiểu tô và bàn tay. Tự nhận diện ảnh chỉ nét/có màu, chọn ngẫu nhiên kiểu phù hợp theo cảnh, cho phép chỉnh lại và lưu lựa chọn để tái xuất nhất quán.

Giữ kiến trúc React/TypeScript → Tauri/Rust → Python sidecar, bàn tay, nền giấy và TTS hiện có. Học hoặc tái sử dụng có chọn lọc thuật toán của [whiteboard-animator](https://github.com/masihsultani/whiteboard-animator/tree/e6e4dbcfc06e65b82490323a78bd9c277a9e2a0b), baseline đã phân tích `e6e4dbc`. Không thay toàn bộ engine ngay; nếu lấy mã/model, giữ LICENSE, attribution và kiểm tra riêng nguồn model trước khi đóng gói.

Trong phạm vi: nhiều cảnh, audio, SRT, nhận diện ảnh, chọn kiểu, tách vùng, nét bút, tô màu, preview, lưu dự án, xuất video và kiểm chứng chất lượng. Sinh ảnh từ prompt, viết lại TTS, forced alignment theo từng từ, transition phức tạp và nhạc nền nâng cao để sau MVP.

## 2. Baseline đã đọc lại

| Phần | Đã có trong mã hiện tại | Còn thiếu hoặc cần nâng cấp |
|---|---|---|
| SRT | Parser chia cảnh, có timelineStartMs/timelineEndMs; UI chọn cảnh và dùng cue/duration của cảnh đó | Danh sách cảnh lưu ảnh/audio/annotation độc lập; xử lý đoạn audio dài hơn SRT |
| Vận hành | Progress, cancel, timeout, kiểm tra/cài Python environment và kiểm thử Rust | Kiểm tra xuyên suốt tiến trình FFmpeg khi hủy; progress/cancel cho cả dự án |
| Tách vùng | Tìm cụm mực bằng OpenCV, gộp vùng, giới hạn mặc định 12 | Phân biệt chữ/hình, chỉnh vùng trực quan, hình có vùng lồng nhau |
| Vẽ nét | Script có grid và skeleton | UI/RPC chưa truyền lựa chọn kiểu nét; cần cải thiện giao điểm |
| Tô màu | Script có contour-wipe và brush | UI/RPC chưa truyền lựa chọn; chưa nhận diện ảnh chỉ nét để bỏ giai đoạn màu |
| Bàn tay/nền | Sprite bàn tay, anchor, nền giấy, match nền | Hiệu chỉnh theo scale/kiểu nét; bảo đảm nhấc bút không tạo nét nối |
| Audio | Xitrum có TTS/audio ở module khác | Whiteboard render request chưa có audio; chưa có quy trình mux theo cảnh |
| Ghép cảnh | API, runner và script merge đã có | Chưa có xuất toàn bộ dự án; fallback PyAV hiện chỉ xử lý video |
| Xuất video | OpenCV ghi MP4V rồi chuyển H.264 | Encode trực tiếp, chuẩn hóa thông số trước concat, cache và manifest |

Căn cứ: `src/components/WhiteboardEditor.tsx`, `src/api.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/executors/whiteboard.rs`, `sidecar-whiteboard/whiteboard_runner.py`, các script và test trong `sidecar-whiteboard/`.

Các nhận xét cũ về chỉ lấy 5 cue, duration cố định 15 giây và thiếu progress/cancel **không còn là baseline hiện tại**. Trước từng giai đoạn, kiểm tra diff đang có để tránh đè thay đổi song song.

## 3. Quy tắc sản phẩm

### 3.1. Mỗi cảnh

- Một ảnh chính, annotation riêng, duration riêng; tùy chọn audio riêng hoặc một đoạn của audio toàn bài.
- Chọn `Tự động`, `Ngẫu nhiên phù hợp` hoặc kiểu cụ thể. UI hiển thị kiểu thực tế đã chọn.
- Tách hai lựa chọn: **vẽ nét** (grid/skeleton/adaptive) và **tô** (none/brush/contour-wipe). Adaptive là chế độ mới, chỉ hiện khi được triển khai và kiểm chứng.
- Bộ phân tích trả loại ảnh và mức tin cậy; người dùng có thể ghi đè `Chỉ nét / Có mảng đen / Có màu`.
- Random chọn từ tập kiểu phù hợp, lưu kết quả vào cảnh; xuất lại không random lại. Nút “Đổi kiểu” mới tạo lựa chọn khác. Tùy chọn hạn chế hai cảnh liên tiếp cùng kiểu khi có nhiều lựa chọn hợp lệ.
- Mặc định dùng Tự động; có thể bật Ngẫu nhiên phù hợp cho toàn bộ dự án.

### 3.2. Audio và thời gian

- Có SRT: ưu tiên timestamp thật; giữ khoảng lặng đầu, giữa và cuối. Không bỏ im lặng bằng cách trừ timestamp cue đầu một lần nữa sau khi đã đổi về thời gian cảnh.
- Có audio nhưng không có SRT: dùng duration audio; chia nhịp heuristic theo vùng/diện tích hoặc lời dẫn nếu có, ghi rõ đây là ước lượng.
- Không có audio: dùng duration do người dùng đặt; vẫn xuất video không tiếng.
- TTS tái sử dụng module sẵn có. Chỉ dùng SRT do TTS/STT tạo nếu đã có timestamp; không tự coi độ dài văn bản là căn chỉnh lời nói chính xác.
- Frame count quyết định duration video: khoảng `round(durationMs × fps / 1000)` frame. Đo sai lệch sau encode bằng ffprobe; mục tiêu sai lệch A/V không quá 1 frame cộng dung sai audio codec được ghi rõ trong test.
- Giữ hình cuối nằm **trong** duration cảnh. Không tự cộng 0,5 giây sau mỗi cảnh.
- Nếu audio dài hơn SRT: mặc định kéo cảnh cuối để giữ đoạn audio cuối; nếu audio ngắn hơn timeline, báo chênh lệch và cho chọn đệm im lặng/điều chỉnh. Không tự cắt lời hoặc tăng tốc tiếng.
- Video cuối hỗn hợp cảnh có/không có audio phải có stream đồng nhất: cảnh không tiếng được đệm silence khi dự án xuất có audio.

## 4. Dữ liệu và kiến trúc đích

```text
Ảnh + audio/TTS + SRT
  → danh sách cảnh có revision
  → phân tích nền/nét/màu/chữ
  → annotation + thứ tự vùng + cửa sổ thời gian
  → chọn kiểu phù hợp, lưu lựa chọn
  → render nét/màu/bàn tay
  → encode + mux audio
  → chuẩn hóa cảnh + concat
  → MP4 + manifest
```

MVP lưu dự án bằng JSON có `schemaVersion` và ghi nguyên tử; tránh mở rộng DB/queue toàn hệ thống khi chưa cần. Media nằm trong thư mục dự án hoặc dùng đường dẫn có bước kiểm tra/relink khi mở lại. Khi tích hợp queue sau này, dùng ID/revision chung với kiến trúc task hiện có.

| Cấp | Trường đề xuất |
|---|---|
| Project | id, schemaVersion, revision, fps, outputSize, paperColor, hand, defaultStyleMode, masterAudio, scenes |
| Scene | id, order, revision, imagePath, annotationPath, timelineStartMs, timelineEndMs, durationMs, cues, audioSource, analysis, style, status, output |
| AudioSource | none/file/masterSegment, path, sourceStartMs, sourceEndMs; luôn dùng khoảng [start, end) |
| Analysis | imageType, background, colorRatio, fillRatio, confidence, detectorVersion, manualOverride |
| Style | mode, requestedInk, requestedFill, resolvedInk, resolvedFill, randomSeed, algorithmVersion |
| Annotation | schemaVersion, canvas, elements; mỗi element có ID, loại, bbox/mask reference, order, startMs, durationMs, protectedRegions |
| Render manifest | project/scene revision, input hashes, settings, engine/model version, actual durations, outputs, warnings |

Tách `analysis` khỏi annotation người dùng chỉnh. Đổi detector không tự ghi đè annotation. Đổi ảnh phải đánh dấu annotation cũ không còn hợp lệ; đổi timing/style/audio chỉ vô hiệu hóa cache tương ứng.

RPC bổ sung dần: `analyze_image`, `render_scene` options có version, `render_project` hoặc điều phối tuần tự bên Rust. Tiến độ mang `taskId`, `projectId`, `sceneId`, `revision`, `stage`, done/total để kết quả cũ không cập nhật cảnh mới. Vẫn giữ adapter đọc annotation cũ và render một cảnh như hiện tại.

## 5. Các giai đoạn triển khai

### W0 — Hợp đồng render và kiểm chứng baseline (P0)

- Định nghĩa TypeScript/Rust/Python types/schema và adapter cho annotation cũ; thay `any` ở các cấu trúc whiteboard trọng yếu.
- Kiểm tra vùng/canvas/timestamp: hữu hạn, kích thước dương, nằm trong cảnh, thứ tự hợp lệ. MVP một đầu bút: yêu cầu cửa sổ tuần tự; không âm thầm kéo dài khi overlap.
- Xử lý timeline theo frame budget; giữ khoảng lặng; bỏ việc chép toàn ảnh cuối để che các pixel bị thiếu. Pixel chưa được phân công phải được đưa vào lịch vẽ hoặc báo rõ trước render.
- Trường `handPath`/`direction` chỉ được hiện là điều khiển khi renderer thực sự hỗ trợ. Adapter cũ giữ metadata nhưng trả warning nếu giá trị bị bỏ qua.
- Bộ fixture: nét đen nền trắng/be, mảng đen đặc, ảnh màu, chữ tiếng Việt, sơ đồ giao điểm/vùng lồng nhau, PNG trong suốt, JPEG nhiễu, ảnh trắng.

Nghiệm thu: mở/render annotation cũ; không vượt duration ngoài dung sai frame; không mất đoạn im lặng đầu; lỗi dữ liệu trả rõ qua RPC; ảnh trắng xuất nền đúng.

### W1 — Quản lý nhiều cảnh và lưu dự án (P0, sau W0)

- Danh sách cảnh từ SRT hoặc tạo tay; gán ảnh/annotation riêng, đổi thứ tự, chỉnh duration, thêm/xóa và lưu/mở dự án.
- Preview cảnh đang chọn, render một cảnh và xuất toàn bộ. Không dùng chung annotation path giữa các cảnh.
- Điều phối tuần tự trước; ghép theo thứ tự cảnh đã lưu, đồng nhất kích thước/fps/codec/pixel format. Thiếu ảnh/annotation phải chỉ đúng cảnh để sửa.
- Lưu trạng thái/revision; output tạm chỉ được thay output chính sau khi kiểm tra thành công. Hủy giữ cảnh đã hoàn tất, không đưa file dở vào danh sách ghép.

Nghiệm thu: dự án ít nhất 3 cảnh, đổi thứ tự/lưu/mở lại đúng, mỗi cảnh đúng ảnh và cue; xuất video không tiếng đủ tổng timeline; sửa một cảnh không làm mất output cảnh khác.

### W2 — Audio xuyên suốt và kết nối TTS (P0, sau W1)

- Thêm chọn audio toàn bài, audio riêng từng cảnh và nhận file từ TTS hiện tại.
- Probe duration/streams. Với audio toàn bài, tính đoạn theo timelineStartMs/timelineEndMs; bảo toàn cả phần lặng và phần audio sau SRT cuối.
- Chuẩn hóa audio sample rate/channel layout; cắt chính xác bằng decode/trim và reset timestamp, không dựa vào stream-copy audio nén để cắt sát cue.
- MVP nhiều cảnh dùng master audio: ưu tiên nối video rồi mux audio toàn bài một lần để tránh tích lũy padding AAC. Audio riêng từng cảnh có thể nối PCM rồi encode AAC một lần.
- Ghép video bằng `-c:v copy` khi codec/thông số phù hợp; audio encode AAC. Khi stream không khớp, chuẩn hóa trước; không dùng fallback PyAV chỉ-video rồi báo thành công với output mất tiếng.
- Resolve executable FFmpeg/ffprobe cho cả dev và app bundle rồi truyền xuống Python; không chỉ phụ thuộc PATH hệ thống.

Nghiệm thu: master audio + SRT có khoảng lặng, audio riêng, cảnh có/không có tiếng, audio dài/ngắn hơn SRT, xuất riêng một cảnh giữa bài. Video giữ lời đọc đầy đủ, đủ streams, A/V trong dung sai đã định.

### W3 — Nhận diện ảnh và random kiểu phù hợp (P1, sau W0; tích hợp UI sau W1)

- Ước lượng nền từ nhiều điểm/cụm màu, composite alpha; loại nền trước khi đo màu và mảng tô. Xử lý màu giấy be, viền chống răng cưa, JPEG nhiễu và màu nhạt.
- Phân biệt line_art_mono, filled_mono, colored, blank, unsupported/uncertain; trả confidence và cho ghi đè. Ảnh có chữ không đồng nghĩa chỉ có nét.
- Truyền inkPath/colorFill/inkWeight/colorWeight xuyên UI → Rust → Python; thêm fill=none và chuyển toàn bộ budget hữu ích sang vẽ nét cho ảnh chỉ nét.
- Chọn/lưu preset: nét → grid/skeleton; mảng đen → nét + tô đơn sắc; ảnh màu → nét + brush/contour-wipe; trắng → giữ nền; ảnh chưa chắc → đề nghị chọn thủ công.
- Random theo scene ID/seed và tập kiểu hợp lệ; nút Đổi kiểu tạo seed/lựa chọn mới, không thay thời lượng/audio. Ban đầu chỉ random kiểu renderer đã hỗ trợ.

Nghiệm thu: cùng dự án xuất lại giữ cùng resolved style; ảnh chỉ nét không lãng phí thời gian ở màu; không nhầm mảng đen thành nét mảnh hoặc nền be thành mảng màu. Báo ma trận phân loại trên fixture thay vì tuyên bố nhận diện mọi ảnh.

### W4 — Tách vùng và chỉnh thứ tự trực quan (P1, sau W1/W3)

- Giữ detector OpenCV nhẹ; thêm CRAFT tùy chọn chạy CPU để phân biệt chữ/hình. Thiếu model có fallback và trạng thái rõ; cài model phải là thao tác rõ trong quản lý môi trường.
- Học component_ordering: hình bao trước nội dung, hình trước nhãn, chữ theo dòng, gắn dấu/chấm đúng nhóm. Kiểm thử riêng tiếng Việt và nhãn nhiều dòng.
- Cho chọn/gộp/tách/sửa bbox, kéo thứ tự và gán cue cho vùng; hiển thị overlay để phát hiện vùng thiếu/chồng nhau.
- Thay việc chỉ trừ bbox vùng sau bằng phân quyền pixel/component hoặc mask phù hợp; không để bbox nhãn làm mất nét của hình bao.
- Có cache phân tích theo hash ảnh/model/settings. CRAFT nhận diện vùng chữ, không tự hiểu nội dung lời đọc; gán cue tự động là gợi ý có thể chỉnh.

Nghiệm thu: chữ và hình được tách hợp lý trên fixture, dấu tiếng Việt không bị bỏ quên; sửa annotation không bị lần phân tích sau ghi đè; các pixel mực đều có chủ sở hữu/lịch vẽ.

### W5 — Nét bút và tô màu thích ứng (P1, sau W4)

- Học skeleton_paths/fill_painters: nét bắt đầu ở endpoint, vòng kín một hướng, xử lý giao điểm thành đường liên tiếp và nhấc bút giữa nét rời.
- Phân loại component thành text/stroke/closed-outline/fill; mảng tô có outline pass rồi brush/sweep. Không áp cùng tỷ lệ nét:màu cho mọi vùng.
- Dùng stroke plan chung cho reveal và sprite: điểm bút, penDown/penUp, thời gian; tránh bút rời đường nhưng mực vẫn hiện hoặc vẽ đường nối giả.
- Cân bằng duration theo độ dài nét/diện tích với giới hạn cửa sổ SRT; thiếu thời gian thì điều chỉnh tốc độ trong giới hạn, báo vùng quá dày để người dùng tăng duration.

Nghiệm thu: bộ ca V/X/vòng tròn/lưới/nhánh cây/chữ có dấu; không mọc đồng loạt từ giao điểm; đầu bút khớp phần đang reveal; cảnh đủ pixel mà không bật nguyên ảnh ở cuối.

### W6 — Encode, cache và nghiệm thu phát hành (P2, sau W2/W5)

- Pipe frame trực tiếp sang FFmpeg H.264; dùng bản đồ thời gian pixel khi thích hợp, chỉ cập nhật phần đang reveal; tối ưu hold bằng tpad khi tương thích bàn tay.
- Giữ đường xuất cũ cho ca cần fallback; fallback phải bảo toàn audio và báo codec/thông số thực trong manifest.
- Cache theo image/annotation/audio hash, duration, styles, fps/size/paper/hand, version engine/model. Kiểm tra output cache có thật và probe hợp lệ.
- Progress theo phân tích/render/encode/mux/merge; hủy dừng cả process tree, đóng pipe và dọn file tạm. Không coi hủy Python là đã dừng mọi FFmpeg con.
- Benchmark cùng fixture, độ phân giải, fps, duration và phần cứng; ghi thời gian, RAM, dung lượng và chất lượng. Chỉ chốt mức tăng tốc sau đo.
- Kiểm tra bản đóng gói trên nền tảng được hỗ trợ: dependency/model path, venv, FFmpeg/ffprobe, Unicode/đường dẫn có dấu/khoảng trắng/dấu nháy.

Nghiệm thu: output có hình/tiếng đúng, tái xuất dùng cache phù hợp, hủy không còn encoder chạy ngầm, không phát hành khi còn lỗi mất tiếng/mất nét/lệch timeline.

## 6. Kiểm thử và mốc bàn giao

Kiểm thử theo thay đổi thực: unit cho phân loại/scheduler/schema; integration qua JSON-lines với render và ffprobe; kiểm tra trực quan frame đầu/giữa/cuối và video chuyển động. Tiếp tục smoke suite hiện có, không thay test thật bằng mock để tuyên bố audio/render hoạt động.

| Mốc | Phạm vi | Điều kiện bàn giao |
|---|---|---|
| A — Video nhiều cảnh có tiếng | W0 + W1 + W2 | Lưu/mở 3+ cảnh, audio/SRT đúng, xuất hoàn chỉnh, hủy an toàn |
| B — Tự chọn kiểu theo ảnh | W3 | Nhận diện nét/mảng đen/màu, override, random ổn định và preview |
| C — Nâng chất lượng hình | W4 + W5 | Chữ/hình, giao điểm, tô thích ứng và bàn tay khớp nét trên bộ fixture |
| D — Tối ưu và đóng gói | W6 | Benchmark, cache, kiểm tra bản bundle và regression |

Thứ tự triển khai mặc định: **W0 → W1 → W2 → W3 → W4 → W5 → W6**. Có thể làm phần phân loại thuần Python của W3 sớm, nhưng không mở rộng UI trước khi mô hình cảnh ổn định. Không ước lượng ngày hoàn tất trước khi chốt fixture và đo baseline W0.

## 7. Điểm sửa dự kiến

- Frontend: `WhiteboardEditor.tsx`, tách scene list/scene settings/annotation preview khi component lớn; `src/api.ts`, bổ sung types whiteboard.
- Rust: `commands.rs`, `executors/whiteboard.rs`, resolver đường FFmpeg/ffprobe và điều phối project có revision; tái sử dụng progress/cancel/environment đã có.
- Python: runner; tách module analysis, schema/style, schedule, audio, project/manifest; cải tiến renderer và merge thay vì dồn toàn bộ vào runner.
- Model: CRAFT là tùy chọn; xác minh gói phụ thuộc trong venv, tránh cài đồng thời hai bản OpenCV xung đột, giữ thông tin nguồn/license model.
- Dự án cũ: đọc annotation cũ, mở luồng render một cảnh; nâng schema bằng adapter, không tự ghi đè file người dùng.

Tài liệu này là đầu vào triển khai. Mỗi mốc cập nhật trạng thái, bằng chứng kiểm thử, giới hạn và thay đổi schema thực tế ngay trong tài liệu hoặc báo cáo liên kết.
