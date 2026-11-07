# Kết quả sửa lỗi Whiteboard 0.7.4

Ngày: 07/11/2026. Tiếp nối [đánh giá trước sửa](danh-gia.md). Không ghi đè ảnh, SRT, audio hoặc video vườn đào gốc.

## Sáu lỗi đã sửa

| Lỗi review | Thay đổi | Kiểm chứng |
|---|---|---|
| F1 — TTS chồng lời | Không cộng waveform. Chặn cue tràn hoặc chồng thời gian, thông báo câu/thời lượng cần sửa trước khi ghi file audio | Fixture inference 3 giây vào cue 2 giây bị từ chối; cue vừa thời gian giữ đúng khoảng lặng và âm lượng |
| F2 — Hình lệch master audio | UI và Rust kiểm tra thứ tự/timeline/duration trước xuất; xung đột phải khôi phục timeline hoặc chuyển sang audio riêng | Rust test đảo hai cảnh và sửa duration bị chặn; dự án không có master vẫn được sắp lại |
| F3 — Bỏ audio mất file | Validate file, audio stream và duration ở runner/mux; file đã chọn bị lỗi không được coi là chế độ không tiếng | Test missing/invalid audio trước render/merge; xuất không tiếng tường minh bỏ audio trong export snapshot |
| F4 — Resume/cache miss | Lookup/render dùng cùng resolver path tay, style và trọng số; chuyển manifest cùng video part→final; hash output chống tái dùng file bị sửa | Test render thật, fingerprint khớp, cache hit sau đổi tên, cache miss khi sửa byte; Rust test publish và xóa manifest cũ |
| F5 — Tô lấn nhóm màu | Mask cọ theo từng cluster; đường cọ bổ sung rìa/nét nhỏ; pass mask riêng khôi phục màu nguồn ở cạnh nét | Fixture nhóm màu kề nhau không hiện nhóm sau ở frame đầu; fixture nét mảnh/mảng màu phủ đủ; render lại ảnh thật |
| F6 — Vùng có hai chủ sở hữu | Vùng sau sở hữu toàn bbox của nó, vùng cha giữ phần bên ngoài; owner_map đồng bộ mask, không giữ dải margin trùng | Nested-mask test không còn pixel sở hữu kép, giữ viền ngoài và phần ruột con |

TTS không tự kéo giãn giọng hoặc thay timestamp: khi câu quá dài, người dùng cần tăng cửa sổ SRT/rút ngắn nội dung. Đây là cách xử lý lỗi tường minh, không phải đã triển khai forced alignment hoặc tự retime lời đọc.

## Các phần bổ sung đã nối

- Skeleton renderer dùng contact plan có thời gian và pen-up để điều khiển cả reveal lẫn vị trí bút. Test xác nhận bút đi qua khoảng trống mà không sinh nét nối.
- Random kiểu phù hợp theo loại ảnh; lưu seed và lựa chọn thực tế vào cảnh để mở/lưu/xuất lại giữ nguyên. Người dùng bấm Đổi kiểu mới tạo lựa chọn khác. Ảnh chỉ nét/trắng không chọn pha tô; ảnh chưa xác định phải chọn thủ công.
- Subject-first được truyền UI → TypeScript API → Rust → Python/CLI và tham gia fingerprint. Phân cụm palette có seed ổn định.
- Đệm silence khi audio ngắn hơn video; giữ hình cuối khi audio dài hơn, gồm chênh lệch dưới 300ms.
- Clip khác kích thước/FPS/codec hoặc thiếu audio được probe/chuẩn hóa trước concat; cảnh không tiếng có silence khi dự án có tiếng. Test kiểm tra hình 160×100/200×120, 10/15fps, một clip không tiếng và một clip có sine: output đồng nhất, đầu im lặng và tiếng ở đúng đoạn sau.
- Encode probe kích thước/duration trước công bố output; đóng stderr pipe; FFmpeg trên Unix kế thừa process group của runner để đường cancel/timeout có thể dừng cả encoder.
- Lưu sửa annotation giữ canvas/metadata gốc; xếp hàng các lần lưu tránh tranh chấp file tạm. Rust test giữ nguyên canvas 2752×1536 sau patch từ editor.
- Editor có chia 2/3 cột và chỉnh bbox để người dùng xử lý ảnh có nhân vật/nền chạm nhau. Đổi thứ tự vùng cũng cập nhật cửa sổ vẽ, không chỉ đổi số sequence. Đây là chỉnh vùng thủ công, không khẳng định OpenCV đã hiểu danh tính ba nhân vật.

## Kiểm tra cuối

- Python: **57/57 test đạt** trong full suite; sau đó chạy lại **10/10 regression test** sau thay đổi seed palette, đạt.
- Rust: **11/11 test whiteboard đạt**; các test khác ngoài filter chưa chạy trong lượt này.
- Frontend: `npm run build` đạt. Còn cảnh báo import động/tĩnh plugin-dialog có sẵn.
- `git diff --check`: đạt.
- Render mới ảnh cảnh 1: skeleton, cạnh dài 640px, 8fps, 30 giây, tắt tay; contour-wipe/brush/palette-brush đều có **0/98.718 pixel nội dung sai khác trên ngưỡng 35 BGR** ở canvas cuối trước encode. Sau siết mask palette đã phát hiện và sửa thiếu nét/rìa, rồi render lại đạt.

[Số liệu render sau sửa](after/results.json). [Contour-wipe](after/contour-wipe.mp4), [brush](after/brush.mp4), [palette-brush](after/palette-brush.mp4).

Chưa thao tác kiểm thử trực tiếp trong UI Tauri, chưa đóng gói/kiểm tra installer hoặc Windows, chưa chạy model TTS thật và nghe chấm chất giọng. Tách vùng tự động vẫn là heuristic OpenCV; CRAFT/model phân tích ngữ nghĩa không được thêm trong đợt sửa lỗi này. Không dùng test pass để tuyên bố các phần này đã được nghiệm thu.
