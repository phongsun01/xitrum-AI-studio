# Kế hoạch nâng cấp Whiteboard lần 2

Ngày lập: **07/11/2026**. Baseline: Xitrum AI Studio **0.7.3**, Git HEAD `4941ec8` và các thay đổi chưa commit tại thời điểm lập kế hoạch.

**Mục tiêu:** xuất đúng dự án đã chỉnh, bảo toàn lời đọc, nâng chất lượng tô màu và chuyển động bàn tay, sau đó giảm chi phí render. Giữ React/TypeScript → Tauri/Rust → Python sidecar và luồng nhiều cảnh/SRT/TTS hiện có. Tích hợp có chọn lọc thuật toán từ `whiteboard-animation-vi` vào từng vùng annotation.

Trạng thái: **kế hoạch triển khai**. Tiếp nối [kế hoạch lần 1](ke-hoach-nang-cap-whiteboard.md); các mục R0–R7 bên dưới chưa được nghiệm thu. Báo cáo W0–W5 trong tài liệu cũ là đầu vào đối chiếu, không thay thế kiểm thử xuyên UI/RPC/render của lần 2.

## 1 Baseline và phần việc chuyển tiếp

| Phần | Mã hiện tại | Việc cần làm lần 2 |
|---|---|---|
| Dự án | Nhiều cảnh, lưu/mở, render lẻ/toàn bộ, tiếp tục xuất | Đồng bộ duration, revision, dữ liệu dự án và điều kiện tái dùng output |
| SRT và TTS | Chia cảnh theo cue, tạo lời đọc, chọn master audio | Khóa quy tắc timeline khi đổi thời lượng/thứ tự; kiểm tra đầu và đuôi audio |
| Nhận diện ảnh | Phân loại nét/mảng đen/màu/trắng, override nét và tô | Sửa alpha; bổ sung fixture màu nhạt, ảnh nhỏ, nền be và độ phân giải khác nhau |
| Tách vùng | OpenCV, heuristic container/hình/chữ | Mask sở hữu pixel; preview và chỉnh vùng; giữ dấu tiếng Việt |
| Nét bút | Grid/skeleton, stroke planner, pen lift, budget thích ứng | Timeline thống nhất cho nét, tô và bàn tay; kiểm tra chuyển động thực tế |
| Tô màu | Brush và contour-wipe | Nhóm màu Lab theo ranh giới mực; tùy chọn chủ thể trước nền |
| Encode | MP4V trung gian rồi H.264 | Pipe thẳng H.264, probe, chuẩn hóa trước concat |
| Resume | Có tùy chọn bỏ qua file cảnh đã tồn tại trên 1.000 byte | Hash đầu vào/cấu hình, manifest và kiểm tra video thực tế |

Các vấn đề phải xử lý trước khi bật thuật toán mới:

- `WhiteboardEditor.tsx` cập nhật `scene.durationMs`, nhưng `render_scene` chưa nhận duration từ cảnh; renderer vẫn đọc `sceneDurationMs` trong annotation. Render toàn dự án có nguy cơ dùng thời lượng cũ.
- `whiteboard_analyzer.py` kiểm tra RGBA bằng `len(img.shape) == 4`; ảnh RGBA thực tế có ba chiều `(H, W, 4)`. Ca màu ẩn dưới alpha trong suốt đã tái hiện kết quả phân loại sai ở lần review.
- `_pyav_concat` trong `merge_scenes.py` chỉ xử lý video và có thể trả thành công khi bỏ audio cảnh.
- Resume hiện kiểm tra kích thước file, chưa chứng minh output còn khớp ảnh, annotation, duration, audio và settings.
- Mở dự án chỉ gán master audio/output khi trường có giá trị; cần xóa state cũ khi mở dự án không có các trường này. Project ID/revision cần ổn định qua các lần lưu và xuất.

## 2 Quy tắc sản phẩm và thời gian

1. **Thứ tự kể chuyện ưu tiên cao nhất:** thứ tự cảnh → thứ tự vùng/cue → chủ thể/nền → nhóm màu → tối ưu đường đi. Bộ tối ưu không được đưa nội dung của cue sau hiện sớm.
2. `scene.durationMs` là nguồn thời lượng để xuất. Annotation mô tả cửa sổ vẽ; nếu cửa sổ vượt duration, báo đúng vùng và yêu cầu sửa hoặc dùng thao tác co giãn rõ ràng. Không tự sửa file annotation gốc khi render.
3. Dự án dùng master audio và cue tuyệt đối giữ cảnh theo timeline nguồn. Đổi thứ tự hoặc duration phải phát hiện xung đột; chỉ xuất sau khi người dùng chọn khôi phục timeline hoặc chuyển sang bố cục tự do. Bố cục tự do cần lưu mapping audio nguồn sang cảnh, không chỉ nối lại timestamp.
4. Tính các mốc frame từ timeline tích lũy: `F(t) = round(t × fps / 1000)`, số frame cảnh bằng `F(end) − F(start)`. Tránh cộng sai số làm tròn độc lập qua hàng chục cảnh. Preview lẻ trong dự án dùng cùng frame budget của cảnh.
5. Hold nằm trong duration; pen-up chiếm thời gian di chuyển nhưng không sinh mực. Ảnh chỉ nét bỏ pha tô. Ảnh trắng chỉ giữ nền và không hiện tay vẽ vô ích.
6. Master audio dài hơn hình: mặc định giữ hình cuối đến hết lời đọc, hiển thị thời lượng hiệu lực trước xuất. Master ngắn hơn hình: đệm silence. Chế độ audio riêng nối audio đã chuẩn hóa với silence cho cảnh thiếu tiếng; encode AAC một lần ở đầu ra cuối.
7. Chế độ audio dự án phải rõ `none/master/per-scene`; khi dùng master, bỏ audio nhúng trong video cảnh bằng stream mapping tường minh. Chưa trộn master và audio riêng trong lần 2.
8. File audio đã chọn nhưng không tồn tại/không đọc được là lỗi cần sửa, không âm thầm xuất không tiếng. Mọi fallback phải bảo toàn hợp đồng streams.

## 3 Kiến trúc dữ liệu đích

```text
Snapshot dự án có revision
  → kiểm tra media và timeline
  → chuẩn hóa ảnh và mask sở hữu pixel
  → lập kế hoạch nét và nhóm màu trong từng vùng
  → lịch contact và pen-up chung cho pixel và tay
  → render frame → FFmpeg H.264
  → ghép video và audio chuẩn hóa
  → probe → ghi output và manifest nguyên tử
```

| Cấu trúc | Trường bổ sung chính |
|---|---|
| Project | ID/revision ổn định, outputSize, timelineMode, audioMode, engineVersion |
| Scene | audioSource, analysis, style, annotationRevision, outputFingerprint |
| AudioSource | loại nguồn, path, sourceStartMs/sourceEndMs, gain mặc định 1 |
| Style | requested/resolved ink và fill, styleMode, seed, subjectFirst, paletteOptions |
| Hand | assetPath/hash, anchor, scale, pose/rotation, shadow và rigVersion |
| RenderPlan | planVersion, canvas, region IDs/masks, strokes, normalized contact time, pen-up, coverage diagnostics |
| Manifest | hashes, versions, effective settings, frame budgets, streams, durations, warnings, output hash và trạng thái complete |

Tăng schema project khi đưa dữ liệu mới vào; giữ adapter đọc v1 và annotation cũ. Chỉ tăng schema annotation khi đổi nội dung annotation. RenderPlan là cache có version, không phải tài liệu người dùng phải chỉnh.

Đổi ảnh làm annotation/mask cũ thành stale; đổi timing chỉ tính lại lịch; đổi tay chỉ render lại frame; đổi audio chỉ làm lại audio/mux khi video không đổi. Đổi detector không ghi đè vùng người dùng đã chỉnh. RPC/progress mang `taskId/projectId/sceneId/revision/stage`; chỉ áp kết quả cho đúng snapshot.

## 4 Các giai đoạn triển khai

### R0 Sửa tính đúng của dự án và audio

**Ưu tiên P0.** Thực hiện trước mọi thay đổi chất lượng hình.

- Truyền duration/frame budget xuyên TypeScript → Rust → runner → renderer cho cả render lẻ và toàn dự án; kiểm tra cửa sổ annotation trước render.
- Sửa xử lý RGBA, dùng chung bước composite/nền giữa analyzer và renderer; xử lý grayscale, ảnh nhỏ và đầu vào không hỗ trợ bằng lỗi rõ ràng.
- Thay fallback mất tiếng; probe và chuẩn hóa kích thước/fps/codec/pixel format/audio trước concat. Escape đúng đường dẫn trong concat list.
- Thêm stream mapping tường minh, chính sách master/per-scene, đệm silence và giữ đuôi lời đọc. Resolver FFmpeg/ffprobe dùng được trong dev và bundle.
- Giữ ID/revision khi lưu; reset state khi mở dự án khác; cập nhật trạng thái stale khi sửa ảnh/style/timing. Tạm không tái dùng output chỉ dựa trên kích thước file; chỉ bật resume xác thực ở R1.
- Bổ sung cancellation token ở vòng điều phối dự án để hủy giữa hai cảnh cũng ngăn cảnh tiếp theo khởi chạy.

**Nghiệm thu:** sửa cảnh 10 giây thành 15 giây sau khi tạo annotation cho kết quả đúng cả hai đường xuất; mở A có audio rồi B không audio không giữ tiếng A; PNG trong suốt tương đương bản composite; master và per-scene đều đủ tiếng ở đường chính/fallback. Nếu fallback không bảo toàn được audio, phải trả lỗi. Dự án 50 cảnh có tổng frame đúng timeline tích lũy.

### R1 Manifest và tiếp tục xuất an toàn

**Ưu tiên P0, sau R0.**

- Tạo fingerprint bằng hash nội dung ảnh, annotation/mask, cấu hình hiệu lực, frame budget, tay, engine version; thêm audio hash và source interval ở tầng mux.
- Chia cache analysis/plan/video/audio/final để thay master audio không bắt vẽ lại toàn bộ cảnh.
- Chỉ nhận cache có manifest `complete`, fingerprint khớp và ffprobe hợp lệ về streams/kích thước/fps/duration. Manifest và output được công bố sau khi kiểm tra; file `.part` không đủ điều kiện resume.
- Tách output theo project ID/scene ID và fingerprint để tránh hai dự án trùng tên cảnh ghi đè nhau. Giới hạn dung lượng cache, có thao tác dọn cache không xóa media gốc.

**Nghiệm thu:** xuất lại không đổi tái dùng cảnh; đổi ảnh tại cùng path vẫn vô hiệu hóa cache; đổi một cảnh chỉ vẽ lại cảnh đó; đổi master chỉ mux lại; output hỏng hoặc manifest thiếu không được bỏ qua. Khôi phục sau hủy không dùng file dở.

### R2 Mask vùng và timeline chung cho bút

**Ưu tiên P1, sau R0–R1.** Mở rộng stroke planner hiện có.

- Chuyển từ trừ bbox sang mask sở hữu pixel cho vùng lồng nhau/chồng nhau, có quy tắc ưu tiên và protected regions. Kiểm tra pixel nội dung chưa được sở hữu trước khi vẽ.
- RenderPlan mô tả stroke, điểm contact, trạng thái pen-up/down, thời gian và brush footprint; reveal và sprite lấy dữ liệu từ cùng plan cho cả nét và màu.
- Lưu thời gian contact bằng float hoặc độ chính xác tương đương đủ cho cảnh dài; không giới hạn mọi chuyển động vào 255 mức thời gian.
- Giữ endpoint/junction/loop planner đã có; phân bổ thời gian theo chiều dài nét, diện tích tô và travel trong cửa sổ cue. Đường rời không có nét nối giả.
- Báo nội dung quá dày/thời lượng quá ngắn; không bật toàn ảnh ở frame cuối để che pixel thiếu.

**Nghiệm thu:** V/X/vòng kín/nhánh cây/chữ có dấu/vùng lồng nhau đều phủ nội dung cần vẽ; mọi pixel mới hiện thuộc footprint của các đoạn contact trong khoảng frame tương ứng. Pen-up không sinh mực. Kiểm tra số liệu trước encode và xem video sau encode.

### R3 Tô theo nhóm màu và ranh giới nét

**Ưu tiên P1, sau R2.** Đây là phần học trực tiếp từ repo tham khảo.

- Thêm `palette-brush` bên cạnh none/brush/contour-wipe. Nhóm màu trong Lab, dùng ranh giới mực để chia vùng liên thông; giữ màu/shading nguồn khi reveal.
- Thực hiện nhóm màu trong mask từng vùng annotation. Hoàn tất nhóm màu rồi mới đổi nhóm; tối ưu travel trong phạm vi không phá thứ tự cue/vùng.
- Thêm hai cách tô nền chi tiết/nhanh sau khi có cùng hợp đồng coverage. “Nhanh” mô tả đường đi đơn giản hơn, không tự giảm duration hay cam kết encode nhanh hơn khi chưa đo.
- Seed và resolved style được lưu. Random chỉ chọn trong tập kiểu hợp lệ; xuất lại không random lại, nút đổi kiểu mới đổi seed.
- Có cleanup nét đa tỉ lệ tùy chọn; kiểm tra dấu tiếng Việt và nét mảnh trước khi dùng làm mặc định.

**Nghiệm thu:** không tô xuyên mask/vùng bảo vệ; giữ shading nguồn; cùng ảnh/settings/seed tạo cùng plan; pixel chưa phủ bằng 0 trên fixture có ground truth. So sánh video với brush/contour-wipe cũ trên cùng ảnh, duration, fps và kích thước; chưa đổi mặc định trước khi duyệt kết quả.

### R4 Bàn tay và chủ thể trước nền

**Ưu tiên P2, sau R2–R3; có thể bàn giao riêng hai phần.**

- R4a: thêm rig tay vẽ/tay tô, anchor theo tọa độ ảnh, chuyển động cổ tay nhẹ, bóng và trạng thái nhấc bút. Dùng asset có quyền phân phối; cho hiệu chỉnh đầu bút và preview trên nền sáng/tối. Giữ lựa chọn sprite hiện tại.
- R4b: thêm subject mask do người dùng chỉnh hoặc nhập; sau đó thử ISNet như dependency/model tùy chọn. Model lỗi/thiếu có fallback tô theo vùng và thông báo rõ.
- Subject priority chỉ áp trong vùng/cửa sổ đang được phép vẽ; segmentation foreground không được coi là hiểu lời dẫn hay nhận diện đúng mọi sơ đồ/chữ.
- Tải model qua thao tác rõ ràng trong quản lý môi trường; pin revision, SHA256, kích thước và nguồn. CPU là đường cơ sở, CUDA tùy chọn; chỉ thêm MPS sau kiểm chứng riêng.

**Nghiệm thu:** đầu bút vẫn khớp contact khi thay scale/anchor/rotation; pen-up không che nội dung quá mức; asset thiếu có lỗi/fallback rõ. Khi bật subject-first, foreground hoàn tất trước background trong cùng vùng. Tắt model vẫn xuất được dự án.

### R5 Encode trực tiếp và hủy toàn bộ tiến trình

**Ưu tiên P1, sau R2; có thể làm trước R4.**

- Trừu tượng hóa frame writer, pipe RGB/BGR sang FFmpeg libx264; loại bỏ MP4V trung gian ở đường mới. Chuẩn hóa resolution/fps/pixel format để concat copy khi tương thích.
- Đọc stderr, xử lý broken pipe/exit code, đóng stdin và chờ encoder; tránh deadlock khi stderr đầy. Probe file trước khi thay output chính.
- Theo dõi process group/job object theo nền tảng để hủy Python và FFmpeg con. Timeout, đóng app và lỗi giữa encode đều đi qua cùng đường cleanup.
- Progress theo analyze/plan/render/encode/mux/verify, không báo 100% trước khi verify xong. Hold chỉ dùng tối ưu lặp frame/tpad khi không còn chuyển động tay.
- Chỉ thêm NVENC sau benchmark CPU; khả năng GPU và encoder được kiểm tra riêng, báo backend thực tế. Không thêm PyTorch vào cài đặt cơ bản chỉ để encode CPU.

**Nghiệm thu:** H.264/yuv420p đọc được, đủ frame; không còn raw MP4 ở đường mới; encoder lỗi giữ nguyên output tốt trước đó. Hủy ở phân tích/render/mux/giữa cảnh không còn process con sau tối đa 5 giây trong môi trường kiểm thử, không ghép file dở.

### R6 Preview và chỉnh sửa trực quan

**Ưu tiên P1 cho preview tối thiểu, P2 cho biên tập đầy đủ.**

- Preview tối thiểu sau R2–R3: ảnh/overlay vùng, thứ tự và cue, mask thiếu/chồng nhau, đường bút và seek theo thời gian. Preview độ phân giải thấp dùng cùng plan với bản xuất.
- Biên tập đầy đủ: chọn/gộp/tách vùng, sửa bbox/mask, đổi thứ tự, gán cue và undo/redo. Lưu annotationRevision, giữ chỉnh sửa khi phân tích lại.
- Hiển thị kiểu thực tế, thông số palette, trạng thái model và cảnh stale. Tách component danh sách cảnh, cấu hình, preview và export khi tích hợp.
- Màn xuất cho thấy tổng thời lượng hiệu lực, nguồn audio và số cảnh tái dùng cần xác thực. Thiếu audio vẫn cho xuất video không tiếng qua lựa chọn rõ ràng.

**Nghiệm thu:** lưu/mở giữ đúng vùng/seed/style/hand; chỉnh một vùng chỉ vô hiệu hóa các tầng cache liên quan; preview và video khớp thứ tự/cue. Renderer chỉ quảng bá các điều khiển đã hỗ trợ.

### R7 Benchmark và nghiệm thu bản đóng gói

**Ưu tiên P1, sau các phần đưa vào phát hành.**

- Chụp baseline cố định trước R0, ghi commit/diff, dependency versions, phần cứng, FFmpeg build và seed. Mã workspace có thể thay đổi song song nên không dùng nhãn phiên bản đơn lẻ làm định danh benchmark.
- Bộ ca gồm nét trắng/be, mảng đen, ảnh màu có shading, chữ tiếng Việt, PNG alpha, JPEG nhiễu, ảnh nhỏ/trắng và vùng lồng nhau. Có clip dài 60–120 giây và dự án 50 cảnh để bắt sai số tích lũy.
- Đo cùng input/settings ở 720p/1080p, 30 fps; chạy cold/warm cache riêng, ít nhất ba lần và báo median, peak RAM, thời gian từng stage, dung lượng, coverage, sai số duration và travel khi so thuật toán route.
- Tách thử nghiệm planner và encoder để biết cải thiện đến từ đâu. Duyệt video chuyển động và frame đầu/giữa/cuối; không dùng test pass làm bằng chứng chất lượng tay tự nhiên.
- Kiểm tra app bundle trên nền tảng phát hành: venv, model/asset path, FFmpeg/ffprobe, đường dẫn Unicode/khoảng trắng/dấu nháy, file thiếu, hết dung lượng và đóng app khi đang xuất.

**Nghiệm thu:** toàn bộ regression liên quan pass; sai số tổng duration video không quá một frame so timeline lượng tử hóa; sai lệch A/V mục tiêu không quá một frame cộng một AAC frame ở sample rate thực, đo qua decode/markers thay vì chỉ container duration. Không phát hành khi còn mất tiếng, cache sai, mất nét hoặc process mồ côi. Chỉ đặt chỉ tiêu tăng tốc sau khi có baseline đo được.

## 5 Thứ tự và mốc bàn giao

| Mốc | Phạm vi | Kết quả bàn giao |
|---|---|---|
| A | R0 + R1 | Xuất đúng thời lượng/tiếng, resume có xác thực, migration dự án |
| B | R2 + R3 + preview tối thiểu R6 | Palette brush và contact timeline, clip đối chiếu, overlay kiểm tra |
| C | R5 | Encode trực tiếp, hủy sạch, benchmark CPU |
| D | R4a + biên tập R6 | Tay chuyển động và chỉnh vùng có lưu/undo |
| E | R4b tùy chọn + R7 | Subject-first được kiểm chứng, bundle và bộ nghiệm thu cuối |

Đường triển khai mặc định: **R0 → R1 → R2 → R3 → R5 → R4a/R6 → R4b → R7**. R7 thu thập baseline từ đầu; R4b không chặn bản nâng cấp CPU. Mỗi mốc có thể phát hành khi đạt nghiệm thu riêng; tính năng mới dùng cờ bật/tắt và giữ adapter cho project cũ. Ước lượng lịch sau khi chốt khối lượng R0–R1 và đo baseline, chưa gán ngày phát hành.

## 6 Phạm vi mã nguồn và kiểm thử

| Nhóm | File hiện có cần cập nhật | Module mới dự kiến |
|---|---|---|
| UI và dữ liệu | `src/components/WhiteboardEditor.tsx`, `src/types/whiteboard.ts`, `src/api.ts` | Các component scene/preview/export khi cần |
| Điều phối | `src-tauri/src/commands.rs`, `src-tauri/src/executors/whiteboard.rs` | Tách project scheduler/process supervision khi command quá lớn |
| Python | `whiteboard_runner.py`, analyzer/schema/segmenter/stroke planner/renderer/audio/merge | `whiteboard_render_plan.py`, `whiteboard_palette.py`, `whiteboard_cache.py`, `whiteboard_encoder.py`, `whiteboard_hand.py` |
| Tài nguyên | `sidecar-whiteboard/assets`, requirements và cấu hình bundle | Model tùy chọn và third-party notices nếu thực sự tích hợp |
| Tài liệu | Hướng dẫn whiteboard, kế hoạch lần 1 | Bảng benchmark và trạng thái nghiệm thu lần 2 |

Các module mới nằm trong `sidecar-whiteboard/scripts/` và chỉ tách khi có trách nhiệm thực tế. Giữ JSON-lines RPC hiện có, thêm trường/version có adapter thay vì thay toàn bộ giao thức.

Kiểm thử gồm unit cho schema/planner/cache; integration JSON-lines với MP4/audio thật; kiểm thử Rust cho điều phối duration/resume/cancel; kiểm thử UI hoặc phiên thao tác có ghi kết quả cho lưu/mở/chỉnh/xuất. Test Python tự dựng dict project chưa đủ để xác nhận round-trip serialization qua Rust hoặc luồng UI.

Lần review trước chạy 32 test Python thành công; tài liệu lần 1 sau đó báo 37 test. Mốc A phải chạy lại suite trên snapshot đã chốt và bổ sung regression cho các lỗi R0–R1; không lấy số test cũ làm kết quả nghiệm thu hiện tại.

## 7 Nguồn tham khảo và phạm vi tái sử dụng

Nguồn thuật toán lần 2: [whiteboard-animation-vi tại c689bf7](https://github.com/letuandat131/whiteboard-animation-vi/tree/c689bf7fd75fb4cb84f6ae2880a4dac6f40b92d0). Các điểm đọc chính: `handdraw/v181d_plan.py`, `v181d_subject_fill.py`, `v181d_cluster.py`, `v181d_hand.py`, `render.py` và `pixels.py`.

Phần code gốc của tác giả dùng CC0; phần Grid upstream giữ MIT, ISNet vendored giữ Apache 2.0. Ảnh bàn tay, artwork và model weights không nằm trong CC0. Nếu tái sử dụng, lưu nguồn/commit và giữ notices tương ứng; dùng asset có quyền phân phối của Xitrum hoặc asset mới. Chi tiết tại [THIRD_PARTY_NOTICES](https://github.com/letuandat131/whiteboard-animation-vi/blob/c689bf7fd75fb4cb84f6ae2880a4dac6f40b92d0/THIRD_PARTY_NOTICES.md).

Ngoài phạm vi lần 2: viết lại TTS, sinh ảnh, forced alignment từng từ, transition phức tạp, dựng video nhiều track và chuyển toàn bộ UI sang Gradio.

## 8 Theo dõi triển khai

| Hạng mục | Trạng thái | Bằng chứng / Ghi chú bàn giao |
|---|---|---|
| **R0** | **ĐÃ HOÀN THÀNH** | Đã sửa composite alpha/grayscale chuẩn hóa (`whiteboard_image.py`), truyền duration xuyên suốt UI/Rust/Python, tự động co giãn nếu annotation vượt duration, stream mapping tường minh & tpad giữ đuôi hình khi audio dài hơn, escape đường dẫn concat, cancellation token giữa các cảnh. Unit test `test_r0_r1.py` pass. |
| **R1** | **ĐÃ HOÀN THÀNH** | Đã triển khai `whiteboard_cache.py`: tạo fingerprint SHA-256 từ nội dung ảnh, annotation, cấu hình render và audio; ghi và xác thực manifest complete; probe video streams trước khi chấp nhận resume cache, vô hiệu hóa file hỏng/file dở dang. |
| **R2** | **ĐÃ HOÀN THÀNH** | Đã triển khai `whiteboard_render_plan.py`: `PixelOwnershipManager` quản lý quyền sở hữu pixel chuẩn xác (giải quyết triệt để vùng lồng nhau, bảo vệ viền container và protectedRegions); `ElementRenderPlan` xây dựng timeline contact points float liên tục `[0.0, 1.0]`, tách biệt quãng đường nhấc bút (pen-up không sinh mực, loại bỏ nét nối giả). |
| **R3** | **ĐÃ HOÀN THÀNH** | Đã triển khai `whiteboard_palette.py` và chế độ tô màu mới `palette-brush`: gom cụm màu sắc trong không gian CIELAB (DeltaE) bám theo ranh giới nét vẽ, hoàn thành một nhóm màu rồi mới đổi sang nhóm tiếp theo, tích hợp mượt mà vào UI và renderer. Suite unit test `test_r2_r3.py` pass. |
| R4 | Có sprite nền tảng | Clip rig/anchor, model optional và nguồn asset |
| R5 | Có encoder/merge cũ | Encode thật, kill-tree, probe và benchmark |
| R6 | Có UI nhiều cảnh nền tảng | Phiên thao tác chỉnh vùng, lưu/mở, preview/xuất |
| R7 | Chưa nghiệm thu | Báo cáo benchmark và checklist bundle theo nền tảng |

Trước mỗi hạng mục, kiểm tra lại diff để tiếp nhận thay đổi mới. Khi hoàn tất, cập nhật trạng thái cùng commit, lệnh kiểm thử, kết quả và giới hạn còn lại; chỉ ghi hoàn thành cho phần đã đạt tiêu chí của chính hạng mục đó.
