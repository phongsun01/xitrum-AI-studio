# Kế hoạch ưu tiên nét vẽ theo đối tượng

> ĐÃ HỦY theo yêu cầu người dùng ngày 2026-11-10. Code ưu tiên nét/mask và hướng dẫn tương ứng trong skill wb đã được gỡ; app trở về renderer/editor trước thay đổi. Nội dung dưới đây chỉ lưu lịch sử plan và kiểm chứng trước khi hoàn tác.

Ngày: 2026-11-10. Repo triển khai: Xitrum AI Studio.

## Hành vi đã chốt

Chỉ ưu tiên pha nét: nét A → nét B → nét C → tô màu theo cơ chế hiện tại. Không gắn thời điểm xuất hiện với lời đọc. “Đối tượng” bao gồm nhân vật, đạo cụ, chữ, phần nền. Số ưu tiên nhỏ hơn vẽ trước; bằng nhau giữ thứ tự annotation. Background chỉ xếp cuối khi người dùng đặt thứ tự tương ứng; không suy đối tượng từ tên gọi.

## Điều chỉnh theo code thực tế

Repo này không dùng trực tiếp `handdraw/*` của whiteboard-animation-vi. Renderer là `sidecar-whiteboard/scripts/render_stream_whiteboard.py`, đã có annotation elements, bbox và PixelOwnershipManager. Luồng cũ vẽ nét rồi tô từng element. Bổ sung chế độ tùy chọn `inkOrder: priority`; mặc định `timeline` giữ luồng cũ.

1. Schema: annotation thêm inkOrder; element thêm inkPriority (số nguyên không âm, mặc định sequence). Có thể gắn maskPath tới ảnh mask xám cùng kích thước canvas; đường tương đối tính từ annotation. Bbox tiếp tục là lựa chọn có sẵn. Mask chuẩn hóa nearest-neighbor; không tự gọi AI tách đối tượng.
2. Ownership: phân bổ pixel theo thứ tự annotation cũ, độc lập priority. Explicit mask chồng nhau báo lỗi; vùng bbox nền có thể bao các đối tượng và nhận phần còn lại. Tôn trọng protectedRegions. Priority không đổi pixel ownership hoặc thứ tự tô.
3. Planner: dựng lịch mới với toàn bộ nét trước màu; giữ budget thích ứng và thuật toán nét grid/skeleton hiện có. Tổng frame không đổi; không chia đều bắt buộc giữa các đối tượng. Với chế độ priority, nén các cửa sổ draw thành một pha chung từ mốc đầu tới mốc kết thúc cuối; bỏ khoảng nghỉ giữa các cửa sổ và phân bố lại theo ngân sách cũ. Giữ khoảng đầu/cuối cảnh. Các vùng instant/fade bị từ chối khi bật chế độ này (tránh lộ màu trước pha tô).
4. Renderer: tách bước chuẩn bị plan, vẽ nét, tô màu. Pha nét sắp theo inkPriority; pha tô giữ thứ tự annotation và nguyên contour-wipe/brush/palette-brush/subjectFirst. Không thay thuật toán palette. Chuyển đối tượng không sinh nét nối. Bản đầu không có hiệu ứng di chuyển tay giữa hai vùng.
5. UI: bật/tắt ưu tiên nét ở cấp cảnh, sửa ưu tiên và chọn mask từng đối tượng trong trình sửa vùng. Lưu vào annotation và project. Không đổi sequence/reveal chỉ vì sửa priority. Import annotation phải nạp cả thông tin mới.
6. Cache/report: hash nội dung mask ngoài annotation; đổi priority/mask làm invalid cache. Tăng engine version và ghi thứ tự nét/màu, frame budget trong render report.
7. Kiểm chứng: schema roundtrip; invalid priority/mask; ownership không đổi theo priority; mask scale/coverage/protection; thứ tự nét đảo nhưng thứ tự/cấu hình tô giữ nguyên; cả grid/skeleton; không có màu trước khi hết nét; frame budget; dự án cũ; cache đổi khi mask đổi; build TypeScript.

## Phạm vi file

- src/types/whiteboard.ts, src/components/WhiteboardEditor.tsx
- sidecar-whiteboard/scripts/whiteboard_schema.py
- sidecar-whiteboard/scripts/whiteboard_ink_order.py (helper mới)
- sidecar-whiteboard/scripts/render_stream_whiteboard.py
- sidecar-whiteboard/scripts/whiteboard_cache.py, project_export.py
- sidecar-whiteboard/whiteboard_runner.py (nếu cần chuẩn hóa đường mask/report)
- tests liên quan, tài liệu sử dụng

## Giới hạn

Ảnh phẳng không phục hồi phần bị che. Mask/bbox do người dùng chỉ định không tự hiểu danh tính trong lời. Các vùng ngoài annotation không tự thêm vào video; muốn vẽ nền còn lại cần một vùng nền bao canvas ở đầu danh sách ownership và priority lớn. Chế độ priority không bảo toàn mốc lời của từng vùng; chỉ bảo toàn tổng cửa sổ vẽ và khoảng giữ hình ngoài cửa sổ.

## Hướng dẫn dùng sau triển khai

Trong Biên tập vùng vẽ của cảnh, bật **Ưu tiên nét theo đối tượng**, nhập **Ưu tiên nét** cho từng vùng (số nhỏ trước). Không đổi sequence bằng mũi tên nếu chỉ muốn đổi pha nét: mũi tên vẫn đổi thứ tự chung, bao gồm tô màu. Các đối tượng cùng priority theo thứ tự thời gian annotation cũ. Priority mặc định bằng sequence.

**Chọn mask** nhận PNG grayscale 8-bit theo kích thước canvas của annotation (trắng = vùng đối tượng, đen = ngoài vùng); mask phải nằm trong region tương ứng. Không có mask dùng region chữ nhật. Có thể chọn **Bỏ mask**. Muốn mask tự do toàn khung thì đặt region bằng canvas. Mask đã chọn không thể chia cột trực tiếp; bỏ mask rồi chia và gán mask riêng. Không hỗ trợ mask explicit chồng nhau; chỉnh mask trước khi xuất. Không tự phân đoạn hoặc đọc kịch bản để tạo mask.

Annotation lưu `inkOrder: "priority"` và `elements[].inkPriority`, `elements[].maskPath`. Đường mask tương đối tính từ annotation; khi nhập qua UI được chuẩn hóa tuyệt đối. Tắt ưu tiên trả về timeline cũ, giữ thông tin priority cho lần bật sau. Đổi kiểu instant/fade yêu cầu tắt ưu tiên trước.

Renderer ghi `<video>.render.json` gồm sự kiện ink/color, ID và số frame. Runner đưa kế hoạch vào manifest; exporter V1 giữ report cạnh clip cache. Cache xét cả byte mask; sửa nội dung mask làm cache hết hiệu lực. Tổng thời lượng cảnh vẫn giữ nguyên; các khoảng trống giữa cửa sổ từng vùng được phân phối lại trong chế độ priority.

## Trạng thái triển khai và kiểm chứng

Đã triển khai schema, mask PNG/region, planner pha nét ưu tiên, pha màu giữ thuật toán/thứ tự cũ, giao diện chỉnh ưu tiên/mask, lưu/nhập project và annotation, cache hash mask và render report. Các sửa đổi có sẵn liên quan phụ đề/App được giữ nguyên.

- 7 bài Python mới đạt, bao gồm cả grid/skeleton và brush/contour-wipe/palette-brush, kiểm tra pixel không lộ sớm, đổi priority không đổi thứ tự màu/final pixels, cache mask, và encode MP4 thật đủ 50 frame ở 10 fps.
- Kiểm thử giao diện Chrome với Tauri mock đạt: bật/tắt, đổi priority không đổi reveal/sequence, chọn mask, lưu project và nhập lại annotation.
- 2 bài Rust mới đạt: serde roundtrip giữ priority/mask/mode; import annotation giải quyết đường mask tương đối và không sửa file nguồn.
- `tsc --noEmit`, Vite production build (`--configLoader runner --outDir /tmp/xitrum-ink-priority-build`), `cargo check --offline` và `git diff --check` đạt.
- Suite Python hiện có chạy 141 bài lúc có 6 bài mới: 135 đạt, 5 lỗi quyền sandbox đã chạy lại thành công, 1 test cũ `test_dong_trac_user_bundle_if_present` kỳ vọng 94000ms trong khi bộ file người dùng hiện là 108000ms. Đã tái hiện cùng lỗi bằng importer từ HEAD trước thay đổi; không sửa dữ liệu truyện hoặc test đó. Sau đó bổ sung bài encode MP4 thật thứ 7 và chạy lại toàn bộ 7 bài mới thành công.

Thay đổi nằm trong mã nguồn; chưa đóng gói/cài lại ứng dụng desktop. Dùng chế độ dev hoặc build lại Tauri để dùng lệnh IPC mới.
