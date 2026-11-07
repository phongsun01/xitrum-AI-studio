# Căn thời lượng bảng trắng theo giọng đọc

Nạp SRT và Chia Cảnh trước, gán ảnh như thường lệ. Bật **Tự căn thời lượng theo TTS (giữ nguyên cảnh và ảnh)** rồi tạo giọng đọc. Đây là chế độ mặc định mới trên giao diện; tắt tùy chọn để giữ nguyên mốc SRT và kiểm tra tràn audio như trước.

Ở chế độ tự căn, engine tạo audio theo từng cue với tốc độ tự nhiên. Giữa các cue cùng cảnh có 150 ms nghỉ; mỗi cảnh giữ thêm 1 giây sau lời cuối. Kết quả trả về audio master, SRT `.aligned.srt` và thời lượng đo thực tế. Phần mềm cập nhật cả bốn ảnh/cảnh theo nhóm cue đã chia, không tự gộp lại theo mốc 25–35 giây. SRT nguồn được giữ nguyên; mỗi lần sinh dùng tên đầu ra riêng.

Nếu đã có annotation, phần mềm tạo bản annotation mới, giữ tọa độ, thứ tự và thuộc tính vùng do người dùng chỉnh; co giãn thời gian để vẽ xong trước cuối lời khoảng nửa giây. Các cảnh được đánh dấu cần render lại. File dự án lưu đường dẫn SRT đang dùng để mở lại đúng bản đã căn.

Annotation tạo mới nhận mốc cue tương đối trong cảnh và mốc kết thúc lời đo thực tế. Khi thiếu mốc lời, bộ xếp lịch dành phần cuối cho phản ứng; thời gian các vùng dự phòng được chia theo căn bậc hai diện tích vùng như một ước lượng độ phức tạp. Không kéo dài cảnh chỉ để đạt thời gian vẽ tối thiểu.

Mỗi vùng có ba cách hiện: **Vẽ nét**, **Hiện ngay**, **Hiện nhanh** (fade tối đa khoảng 0,2 giây). Nền có thể hiện ngay, phần quan trọng mới diễn vẽ. Các chế độ đều tuân thủ vùng sở hữu pixel để không làm lộ phần khác.

Bản này căn theo thời lượng audio/cue, chưa căn từng từ hoặc tự hiểu chi tiết gây cười. Kiểm tra thứ tự và vị trí hé lộ trong phần chỉnh vùng. Việc tách số vùng khỏi số cue là bước riêng, chưa thay đổi trong lần sửa này. Tránh bấm Chia Cảnh lại bằng chế độ gộp tự động sau khi căn vì có thể thay đổi nhóm ảnh.

Kiểm tra: `python3.11 -m unittest discover -s sidecar-whiteboard/tests -v`, `node --test src/lib/whiteboardTiming.test.mjs`, `npm run build`, và `cargo test --offline --manifest-path src-tauri/Cargo.toml audio_timing_regression_tests`.
