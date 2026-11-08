# Hướng dẫn triển khai Whiteboard: nạp ảnh và tạo mẫu hàng loạt

Ngày lập: **09/11/2026**. Trạng thái: **đề xuất triển khai, chưa thực hiện**.

## 1. Mục tiêu

Rút ngắn thao tác từ chọn từng ảnh → tạo mẫu từng cảnh → chọn ảnh bìa thành:

1. Nhập bộ SRT + `.wb.json` để có đúng cấu trúc cảnh một/nhiều giọng.
2. Bấm **Nạp ảnh từ thư mục**, xem mapping rồi áp dụng toàn bộ.
3. Tạo TTS và tự căn nếu cần, sau đó bấm **Tạo mẫu tất cả** để tạo lịch vẽ theo timing cuối.
4. Kiểm tra ảnh bìa, sửa các cảnh cần thiết và xuất video.

Hai thao tác mới phục vụ bộ ảnh có tên theo số như `1.png`, `2.png`, `3.png` và `thumb.png` hoặc `thumbnail-9x16.png`. Không sinh ảnh bằng AI, không tự tạo TTS hoặc xuất video khi người dùng chỉ yêu cầu nạp ảnh/tạo mẫu.

Số ảnh bằng **số cảnh**, không bằng số cue. Một cảnh chứa ba người nói vẫn chỉ nhận một ảnh.

## 2. Hiện trạng và nơi cần sửa

| Thành phần | Hiện trạng | Thay đổi dự kiến |
|---|---|---|
| `src/components/WhiteboardEditor.tsx` | `handlePickSceneImage` chọn và phân tích một ảnh; `handleAutoAnnotationCurrent` tạo annotation một cảnh | Thêm preview mapping ảnh, apply theo batch, hàng đợi tạo mẫu và tiến độ |
| `src/api.ts` | Có API phân tích ảnh và tạo annotation; chưa có luồng nạp cả bộ | API chọn thư mục, kiểm tra media và lập mapping |
| `src/types/whiteboard.ts` | Scene đã lưu ảnh, annotation và revision | Kiểu dữ liệu preview, kết quả batch và chế độ thumbnail |
| `src-tauri/src/commands.rs` | Command đọc ảnh bìa, phân tích/tạo mẫu; xuất dự án kiểm tra thumbnail | Quét thư mục, kiểm tra ảnh, xử lý bìa nhập trực tiếp và validation tương ứng |
| Executor/sidecar Whiteboard | Có pipeline phân tích ảnh, annotation và render | Dùng lại pipeline; chỉ mở rộng nếu cần quản lý batch/progress tại backend |
| `src/lib/whiteboardThumbnail.ts` | Tạo bìa bằng ảnh minh họa và chữ | Giữ luồng tạo bìa; bổ sung dùng bìa hoàn chỉnh mà không ghép chữ lần nữa |

Hiện chọn ảnh mới chỉ đặt **đường dẫn dự kiến** của annotation. Có `annotationPath` không đồng nghĩa file mẫu đã tồn tại hoặc còn phù hợp.

## 3. Quy tắc tìm và gán ảnh

### 3.1. Chọn nguồn

- Nút **Nạp ảnh từ thư mục** mặc định đề xuất thư mục chứa SRT hiện tại; cho người dùng chọn thư mục khác.
- Bản đầu chỉ quét thư mục được chọn, không quét đệ quy để tránh lấy nhầm ảnh tham chiếu nhân vật hoặc bản cũ.
- Hỗ trợ `.png`, `.jpg`, `.jpeg`, `.webp` nếu pipeline đọc/render thực sự hỗ trợ; tên đuôi không phân biệt hoa/thường. Nếu thêm WebP phải kiểm tra xuyên các API và bản đóng gói, không chỉ thêm vào bộ lọc.
- Chỉ scan/preview khi bấm nút. Không tự thay ảnh của project khi mở hoặc chọn lại SRT.

### 3.2. Mapping theo thứ tự cảnh

| Tên file | Cảnh đích |
|---|---|
| `1.png` hoặc `01.png` | Cảnh ở vị trí thứ nhất trong timeline |
| `2.jpg` hoặc `02.jpg` | Cảnh ở vị trí thứ hai |
| `10.png` | Cảnh ở vị trí thứ mười |
| `thumb.png`, `thumbnail.png`, `thumbnail-9x16.png`, `thumbnail-16x9.png` | Ứng viên ảnh bìa, không tính là ảnh cảnh |

- So theo số nguyên dương của stem, không sort chuỗi kiểu `1, 10, 2`. Index là thứ tự cảnh hiện tại, không suy từ đuôi ID scene.
- `1.png` và `01.jpg` đều trỏ cảnh 1: đánh dấu **trùng**, yêu cầu chọn một file. Không tự chọn theo extension hoặc ngày sửa.
- Ảnh vượt số cảnh được liệt kê là dư, không tự tạo thêm cảnh. Thiếu ảnh không làm các ảnh sau dồn lên sai vị trí.
- Tên không theo quy tắc được liệt kê là bỏ qua. Không lấy ảnh thumbnail để bù cảnh thiếu.
- Không đọc đường dẫn tuyệt đối trong `images.json` rồi áp dụng âm thầm. Nếu bổ sung import manifest sau này, kiểm tra tồn tại, mapping và đường dẫn trước; ưu tiên cấu trúc portable dùng đường dẫn tương đối so với manifest.

### 3.3. Preview và áp dụng

Preview hiển thị mỗi cảnh: số/thời lượng, ảnh đang dùng, ảnh mới, trạng thái **sẵn sàng / thiếu / trùng / ảnh lỗi**; hiển thị riêng ứng viên bìa. Đọc được kích thước/định dạng ảnh trước khi báo sẵn sàng, không chỉ kiểm tra extension.

- Mặc định **chỉ điền cảnh chưa có ảnh**. Có lựa chọn rõ **thay ảnh các cảnh đã có**, với số cảnh bị ảnh hưởng.
- Cho phép chọn một phần các hàng hợp lệ để áp dụng; hàng thiếu/trùng/lỗi không được áp dụng. Cảnh ngoài phạm vi giữ nguyên.
- Snapshot gồm project ID/revision, scene IDs/thứ tự và ảnh hiện tại. Trước apply, kiểm tra lại file và snapshot; dự án hoặc file đổi thì yêu cầu preview lại, tránh áp kết quả cũ vào project khác.
- File có thể bị thay ngay tại cùng đường dẫn: dùng hash nội dung hoặc fingerprint đáng tin cậy để nhận diện, không chỉ so path.
- Thay ảnh làm mất hiệu lực annotation/video cũ của cảnh đó. Giữ file trên đĩa để tránh xóa chỉnh sửa; bỏ liên kết annotation không còn khớp, tăng revision, reset output/status/error. Không tự ghi đè mẫu đã chỉnh.
- Chỉ đổi ảnh/annotation không làm thay lời hoặc timing: giữ audio TTS hiện tại nếu fingerprint lời/giọng/timeline vẫn khớp, nhưng vô hiệu hóa video cuối và bìa phụ thuộc ảnh đã đổi.
- Apply mapping thành một lần cập nhật state theo scene ID, không gọi liên tiếp handler đang phụ thuộc `activeScene`.

## 4. Tạo mẫu annotation hàng loạt

### 4.1. Giao diện

Thêm nút **Tạo mẫu tất cả** cạnh vùng quản lý cảnh, kèm lựa chọn:

- **Chỉ tạo mẫu còn thiếu** — mặc định.
- **Tạo lại các cảnh đã chọn** — thông báo số mẫu đã có bị ảnh hưởng; kết quả mới ghi file phiên bản khác để có thể phục hồi.

Hiển thị tiến độ `Đang tạo mẫu cảnh 2/4`, số thành công, bỏ qua, lỗi và nút **Dừng sau cảnh hiện tại**. Mỗi cảnh có lỗi riêng và được chọn chạy lại. Không tuyên bố hủy ngay suy luận đang chạy nếu backend chưa hỗ trợ.

### 4.2. Hàng đợi và xử lý scene

1. Chờ `annotationSaveQueue` hoàn thành, chụp snapshot các scene cần tạo mẫu.
2. Kiểm tra ảnh tồn tại/đọc được và annotation hiện có. File mẫu phải parse/validate được, khớp ảnh, scene, canvas và timing; chuỗi `annotationPath` có giá trị chưa đủ điều kiện bỏ qua.
3. Với mẫu có nhưng thiếu bằng chứng còn khớp, báo cần kiểm tra/tạo lại thay vì âm thầm ghi đè. Khi đã có provenance/fingerprint, dùng nó để quyết định tái sử dụng.
4. Phân tích style ảnh bằng `analyzeWhiteboardImage`; dùng kết quả khi cảnh chưa có lựa chọn thủ công. Giữ `styleMode/manual` và override của người dùng. Một cảnh lỗi phân tích phải có cảnh báo hoặc lỗi rõ, không áp style của cảnh trước.
5. Gọi `generateWhiteboardAnnotation` với ảnh, ID cảnh, duration và cue đã chuyển sang thời gian **tương đối của cảnh**:

   ```ts
   startMs = cue.startMs - scene.timelineStartMs;
   endMs = cue.endMs - scene.timelineStartMs;
   speechEndMs = cue.speechEndMs === undefined
     ? undefined
     : cue.speechEndMs - scene.timelineStartMs;
   ```

6. Validate response và file annotation thực tế; giữ hình học/lịch vẽ đúng duration và speech window. Chỉ sau đó cập nhật `annotationPath`, `elements` và trạng thái cảnh.
7. Kiểm tra snapshot/scene revision trước khi nhận kết quả. Nếu ảnh, timing hoặc project đổi, không gắn mẫu cũ vào cảnh mới.
8. Lỗi một cảnh được ghi nhận và tiếp tục các cảnh khác; kết thúc báo tổng hợp và danh sách cần làm lại. Không báo hoàn thành toàn bộ nếu còn lỗi.

Bản đầu chạy **tuần tự** để kiểm soát bộ nhớ, tải xử lý và giao thức sidecar. Không bọc nhiều lời gọi lên cùng runner trong `Promise.all` nếu executor không hỗ trợ an toàn.

### 4.3. Lưu file và tính nhất quán

- Đường dẫn mẫu nên ở thư mục output riêng của project, bao gồm project ID, scene ID và revision/fingerprint, ví dụ `annotations/<project-id>/<scene-id>.<fingerprint>.json`.
- Không giả định thư mục ảnh có quyền ghi. Không coi tên `1.scene-01.annotation.json` là đủ tránh đụng giữa hai project dùng cùng ảnh.
- Ghi file tạm, validate rồi công bố nguyên tử. Lỗi/dừng không để file dở thành mẫu hợp lệ hoặc ghi đè file nguồn.
- Khi đã có kết quả hợp lệ, tăng revision cảnh và vô hiệu hóa video chịu ảnh hưởng. Kết quả từng cảnh đã thành công được giữ nếu cảnh sau lỗi/dừng.
- Đổi giọng và tự căn sau khi tạo mẫu vẫn phải đi qua retime hiện có và có thể cần render lại. Luồng khuyến nghị tạo TTS/timing trước rồi mới tạo mẫu giúp giảm công việc lặp.

## 5. Thumbnail: ảnh minh họa và bìa hoàn chỉnh

Tên `thumbnail*.png` chỉ nhận diện **ứng viên bìa**, không chứng minh ảnh đã có chữ. Không cần OCR để quyết định; người dùng chọn trong preview:

| Chế độ | Hành vi |
|---|---|
| **Ảnh minh họa để tạo bìa** | Gán ảnh bìa, lấy tiêu đề từ project/WB, dùng trình tạo thumbnail hiện tại để ghép chữ |
| **Dùng thumbnail hoàn chỉnh** | Nhập ảnh thành bìa cuối, không ghép chữ hoặc áp preset typography lần nữa |

- Khi chỉ có một ứng viên, tự điền ảnh vào preview, cho chọn chế độ. Có nhiều ứng viên thì yêu cầu chọn; không tự lấy `thumbnail-9x16.png` cho video 16:9.
- Đọc tỷ lệ từ kích thước ảnh thật; tên file chỉ là gợi ý. Với tỷ lệ khác video, preview nêu rõ cách fit/pad giữ nội dung hoặc cho chọn ảnh khác, không crop âm thầm mất chữ.
- Nạp ảnh bìa minh họa không có nghĩa đã tạo được thumbnail hợp lệ. Người dùng có thể chọn thêm **Tạo bìa sau khi nạp**, nếu đủ tiêu đề/ảnh và đã xác định chế độ.
- Nếu tạo thumbnail lỗi, giữ ảnh cảnh đã nhập và báo phần bìa chưa hoàn thành; không báo cả batch thất bại hoặc hoàn tất sai.

### Thay đổi dữ liệu bắt buộc khi hỗ trợ bìa hoàn chỉnh

Hiện `thumbnailReady` gắn với title, font, bút, layout và typography version của bìa được tạo trong app. Bổ sung trường phân biệt, ví dụ `thumbnail.mode: generated | imported`, mặc định `generated` khi mở project cũ.

- `generated`: giữ các điều kiện hiện có; đổi title/font/bút/ảnh nguồn khiến cần tạo lại.
- `imported`: validate media, dữ liệu ảnh và tỷ lệ; không buộc mang layout/font/typography của trình ghép chữ. Đổi bút hoặc title metadata không tự phủ chữ lên ảnh đã hoàn chỉnh.
- Cập nhật đồng thời TypeScript, struct Rust, `thumbnail_png`, điều kiện xuất ở `commands.rs`, renderer/validator sidecar và lưu/mở project. Không chỉ sửa state để nút xuất sáng lên.
- Cân nhắc lưu PNG đã chuẩn hóa trong project theo hợp đồng hiện có để mở lại không phụ thuộc ảnh gốc; kiểm tra giới hạn dung lượng/kích thước, không chỉ đường dẫn tồn tại.
- Giữ thời lượng chèn bìa hiện hành; tính năng này không thay đổi cơ chế audio/timeline hoặc tự đăng video.

## 6. Thứ tự triển khai

| Mốc | Công việc | Điều kiện đạt |
|---|---|---|
| B1 | Chốt hợp đồng scan/preview, mapping tên ảnh và fixture | Nhận đúng thứ tự số, báo thiếu/trùng; bìa không lọt vào ảnh cảnh |
| B2 | Backend scan thư mục, kiểm tra media/fingerprint; API và UI apply | Một thao tác gán đúng N cảnh; hủy không đổi project; thay ảnh vô hiệu hóa đúng dữ liệu phụ thuộc |
| B3 | Hàng đợi phân tích/tạo mẫu, provenance và file phiên bản | Chỉ tạo mẫu thiếu hợp lệ; giữ mẫu đã chỉnh; tiến độ/lỗi/dừng hoạt động |
| B4 | Nhận ảnh bìa và chế độ imported/generated xuyên các tầng | Không ghép chữ hai lần; preview đúng tỷ lệ; lưu/mở và xuất đúng bìa |
| B5 | Kiểm thử xuyên luồng và cập nhật hướng dẫn | Nạp bộ ảnh → timing/TTS → tạo mẫu → lưu/mở → xuất, giữ số cảnh và đủ lời |

Có thể giao B1–B3 trước để giảm ngay thao tác chọn ảnh/tạo mẫu. B4 có thay đổi hợp đồng thumbnail và cần nghiệm thu riêng; không đánh dấu bìa hoàn chỉnh đã hỗ trợ khi mới tự điền đường dẫn ảnh.

## 7. Ma trận kiểm thử

| Nhóm | Ca bắt buộc |
|---|---|
| Mapping | `1,2,10`; `01`; đuôi hoa/thường; trùng `1.png/01.jpg`; thiếu ảnh 2 không dồn ảnh 3; file dư; thumbnail tách khỏi cảnh |
| Media | Ảnh hỏng dù đuôi hợp lệ; file bị xóa/thay nội dung sau preview; thư mục không cho ghi; project di chuyển thư mục |
| Apply | Chỉ điền cảnh thiếu; thay ảnh có xác nhận; hủy giữ nguyên; mở project khác/thay thứ tự cảnh khi scan; một cảnh nhiều cue vẫn một ảnh |
| Annotation | Path có nhưng file chưa tồn tại; file hỏng; mẫu đã chỉnh; duration/cue đổi; override style; lỗi một cảnh và retry; dừng sau cảnh hiện tại |
| Thời gian | Cảnh thứ hai bắt đầu khác 0, cue gửi sang tạo mẫu có offset tương đối đúng; TTS tự căn rồi tạo mẫu dùng timing mới |
| Thumbnail | Một/nhiều ứng viên; ảnh có chữ dùng trực tiếp; ảnh minh họa ghép chữ; tỷ lệ 9:16/16:9; lưu/mở cũ/mới và điều kiện xuất đúng mode |
| Regression | Nhập một giọng schema 2, nhiều giọng schema 3, chọn ảnh/tạo mẫu từng cảnh và luồng thumbnail cũ vẫn hoạt động |

Test mapping/validator bằng fixture và fake backend; test UI bằng Tauri IPC giả lập; thử tạo annotation/render thật để xác minh file và timeline. Build frontend, Rust tests và Python tests liên quan phải đạt. Không coi test mock là bằng chứng chất lượng lịch vẽ hoặc hình bìa cuối; xem khung hình đầu ra và ghi phần chưa kiểm chứng.

## 8. Bộ thử thực tế: Đổng Trác uống trà

Thư mục: `wb-projects/04. Dong Trac uong tra/`.

- Bộ SRT/schema 2 hiện có 3 cảnh; nạp `1.png`, `2.png`, `3.png` vào đúng ba cảnh.
- `thumbnail-9x16.png` là ứng viên bìa riêng; cần xem ảnh và chọn minh họa/hoàn chỉnh, xử lý chênh tỷ lệ với video nếu có.
- `images.json` hiện chứa đường dẫn tuyệt đối về thư mục khác; scan theo ảnh tại thư mục đang chọn để không phụ thuộc các đường dẫn cũ.
- Nghiệm thu: nhập WB → nạp đủ 3 ảnh trong một lần → chọn bìa → tạo TTS → tạo mẫu cả 3 cảnh → chỉ sửa ngoại lệ → lưu/mở → xuất thử. Không sửa bộ file nguồn khi chạy test.

## 9. Hướng dẫn người dùng sau khi triển khai

1. Chọn SRT và **Nhập theo phân cảnh từ WB**.
2. Bấm **Nạp ảnh từ thư mục**, chọn thư mục chứa ảnh `1,2,3…`.
3. Kiểm tra preview, xử lý hàng thiếu/trùng và xác định ảnh bìa; bấm **Áp dụng**.
4. Chọn giọng và tạo TTS. Nếu tự căn, chờ timeline cập nhật xong.
5. Bấm **Tạo mẫu tất cả → Chỉ tạo mẫu còn thiếu**; kiểm tra báo cáo, xem/sửa các vùng cần thiết.
6. Hoàn tất thumbnail theo chế độ đã chọn, lưu dự án và xuất video.

Mục tiêu hoàn thành là giảm thao tác lặp theo từng cảnh, đồng thời bảo toàn ảnh, mẫu đã chỉnh, phân vai và timeline của dự án.
