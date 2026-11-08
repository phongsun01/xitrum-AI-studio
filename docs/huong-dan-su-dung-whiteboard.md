# Hướng Dẫn Sử Dụng Tính Năng Whiteboard (Vẽ Tay Bảng Trắng) Trên Xitrum AI Studio

Tài liệu này hướng dẫn chi tiết quy trình tạo video hoạt hình bảng trắng vẽ tay (Whiteboard Explainer Video) nhiều phân cảnh với âm thanh thuyết minh đồng bộ trên ứng dụng **Xitrum AI Studio**.

---

## 1. Chuẩn Bị Tài Nguyên Dự Án

Trước khi bắt đầu trên giao diện ứng dụng, bạn nên chuẩn bị thư mục chứa các tài nguyên sau:

1. **File Phụ Đề (`.srt`)**: 
   - Chứa mốc thời gian và lời thoại dẫn dắt.
   - Trình phân tích của app sẽ dựa vào các mốc nghỉ trong SRT để đề xuất chia video thành các cảnh (mỗi cảnh thường kéo dài từ 25s – 35s).
2. **File Thuyết Minh Master (`.wav` hoặc `.mp3`)**:
   - Âm thanh thu sẵn hoặc xuất từ module TTS của Xitrum AI Studio.
   - Thời lượng audio thường khớp hoặc dài hơn tổng thời lượng phụ đề SRT.
3. **Ảnh Minh Họa Cho Từng Cảnh (`.png` hoặc `.jpg`)**:
   - Tỷ lệ khung hình khuyến nghị: 16:9 (ví dụ `1920x1080` hoặc `1280x720`).
   - Phong cách tối ưu: Tranh phác thảo (Line-art), nét vẽ đen/màu trên nền trắng/sáng rõ ràng.
4. *(Tùy chọn) Bút vẽ / Bàn tay tùy biến*:
   - Đặt tại `sidecar-whiteboard/assets/drawing-hand.png`.
   - Ảnh PNG nền trong suốt (RGBA), đầu ngòi bút hướng chính xác về góc trên bên trái của ảnh.

---

## 2. Giao Diện & Môi Trường Hoạt Động

Vào tab **Whiteboard** trên thanh điều hướng ứng dụng:

```
+---------------------------------------------------------------------------------+
|  Thanh công cụ: [Mở Dự Án] [Lưu Dự Án] [Xuất Toàn Bộ Dự Án]                     |
|  Nguồn phụ đề:  [ Chọn file .srt ... ]            [ Chia Cảnh Tự Động ]         |
+------------------------------------+--------------------------------------------+
|  DANH SÁCH PHÂN CẢNH (Trái)        |  CHI TIẾT PHÂN CẢNH ĐANG CHỌN (Phải)       |
|                                    |                                            |
|  [+] Thêm Cảnh Mới                 |  - Tên cảnh, ID, Thời lượng (ms)           |
|                                    |  - Ảnh đầu vào (Chọn file)                 |
|  * Cảnh 1: Khởi đầu (00:00-00:30)  |  - File kịch bản nét vẽ (Annotation JSON)  |
|    [^] [v] [Xóa]                   |    -> [ Tạo Mẫu Tự Động ]                  |
|                                    |  - Thời gian vẽ (ms), Giữ hình (ms)        |
|  * Cảnh 2: Thề nguyện (00:30-01:05)|                                            |
|    [^] [v] [Xóa]                   |  [ Render Thử Cảnh Này ]                   |
|                                    |  [ Xem Video Cảnh ]                        |
+------------------------------------+--------------------------------------------+
|  Trạng thái & Tiến trình: [████████████████......] 65% - Đang vẽ nét cụm 14/20 |
+---------------------------------------------------------------------------------+
```

### Bước 0: Kiểm tra môi trường (Python & FFmpeg)
- Nhìn vào góc trên bên phải màn hình:
  - Nếu hiện biểu tượng xanh lá **"Môi trường sẵn sàng"**: Bạn có thể làm việc ngay.
  - Nếu báo thiếu thư viện hoặc thiếu `ffmpeg`: Bấm nút **"Cài tự động"** để app tải các gói phụ thuộc Python vào virtual environment của sidecar.

---

## Ảnh bìa thumbnail và đoạn mở đầu 2 giây

Trong khung **Ảnh bìa · 2 giây đầu**, nhập tiêu đề, chọn một trong 10 mẫu bút và chọn ảnh PNG/JPG riêng hoặc **Dùng ảnh cảnh đầu**. Bấm **Tạo thumbnail** để dựng ảnh bìa bằng Fabric.js và xem trước ngay trên giao diện. Ảnh minh họa phủ kín khung 16:9, tiêu đề căn giữa trong khoảng trống 30% phía trên. Nên chuẩn bị tranh có vùng trời/giấy thoáng ở phía trên và nhân vật ở phía dưới. Mỗi mẫu bút có preset kiểu chữ và màu chữ riêng; ảnh minh họa gốc không được AI chuyển phong cách. Watermark nhỏ `xitrum-AI-studio` luôn có trên bìa.

**Font tiêu đề** mặc định là **Tự động theo bút**: bút lông dùng Charm, bút tre dùng Mali, bút lông vũ/vintage dùng Bitter, bút kỹ thuật/cyberpunk dùng Chakra Petch, bút digital/bút dạ dùng Be Vietnam Pro, bút pha lê dùng Charm và wand dùng Grenze Gotisch (Gothic fantasy). Hiệu ứng đi theo bút: mực thư pháp, nét cổ điển, neon, ánh pha lê hoặc chữ vàng với quầng sáng tím cho wand. Đây là font fantasy độc lập, không phải font thương hiệu Harry Potter.

Có thể chọn riêng một trong 6 font; lúc đó đổi bút chỉ đổi hiệu ứng, giữ nguyên font đã chọn. Chọn lại **Tự động theo bút** để khôi phục đổi font tự động. Cả 6 font hỗ trợ đầy đủ chữ và dấu tiếng Việt, được đóng gói trong app tại `public/fonts/thumbnail/` kèm giấy phép OFL. Không tải font từ CDN và không yêu cầu cài font hệ điều hành. Nếu font không tải được, app báo lỗi thay vì xuất bằng font thay thế.

Font của ảnh đã tạo và font bản nháp được lưu riêng trong dự án. Bìa cũ cần tạo lại để áp dụng font/hiệu ứng mới.

Bấm **Tạo lại thumbnail** sau khi đổi tiêu đề, font, mẫu bút hoặc ảnh nguồn. Bìa cũ theo bố cục chữ bên cạnh ảnh cũng cần tạo lại để chuyển sang ảnh tràn khung. Ứng dụng cảnh báo nếu bản xem trước không còn khớp cấu hình, và yêu cầu tạo lại trước khi xuất. Có thể tải ảnh PNG từ liên kết dưới bản xem trước.

**Lưu Dự Án** lưu cả ảnh PNG 1280×720 và cấu hình vào tệp `.whiteboard.json`. Mở lại dự án sẽ khôi phục nguyên ảnh bìa, không cần ảnh nguồn để xem hoặc xuất lại. Dự án cũ vẫn mở được; hãy tạo thumbnail trước khi xuất toàn bộ.

**Xuất Toàn Bộ Dự Án** dùng đúng ảnh đã xem trước, chèn tĩnh **2.000 ms** ở đầu video, giữ im lặng trong đoạn bìa. Tất cả audio (master hoặc audio riêng từng cảnh) và nội dung cảnh bắt đầu sau đoạn bìa. Render thử từng cảnh không có bìa; xuất tiếp/resume chỉ chèn bìa một lần trong bước ghép cuối. Thời gian trong editor/SRT nguồn vẫn tính theo nội dung, không cộng bìa vào từng cảnh.

## 3. Quy Trình Thao Tác Từng Bước

### Bước 1: Nhập phụ đề, âm thanh và chia cảnh
1. **File phụ đề (.srt)**: Bấm nút duyệt file và chọn file `.srt`. Khi chọn xong, app sẽ tự động tìm kiếm file âm thanh `.wav` cùng tên trong thư mục để gán làm âm thanh Master.
2. **Âm thanh thuyết minh (Master Audio)**:
   - *Nếu đã có sẵn file thu âm/TTS*: Bấm nút **"Chọn Audio"** ngay bên dưới để chọn file `.wav` hoặc `.mp3`.
   - *Nếu chưa có và muốn tự động tạo*: Chọn 1 trong 25 giọng đọc VieNeu (ví dụ: *Thùy Dung - Nữ miền Nam, Thái Sơn - Nam miền Nam, Hải Đăng - Nam miền Bắc*, v.v.) và bấm nút **"Tạo TTS"** (biểu tượng micro). Hệ thống sẽ đọc toàn bộ kịch bản SRT và tạo ra file âm thanh hoàn chỉnh đồng bộ theo mốc thời gian.
3. Bấm nút **"Chia Cảnh"**: Hệ thống sẽ tự động quét các khoảng lặng và mốc thời gian trong SRT để sinh danh sách các cảnh tối ưu.

### Bước 2: Tinh chỉnh danh sách phân cảnh (Cột bên trái)
- **Chọn cảnh**: Bấm chuột vào thẻ cảnh để xem và chỉnh sửa thông tin chi tiết ở cột bên phải.
- **Sắp xếp thứ tự**: Bấm biểu tượng **Mũi tên lên (▲)** hoặc **Mũi tên xuống (▼)** để đổi thứ tự xuất hiện của các cảnh.
- **Xóa bớt cảnh**: Bấm biểu tượng **Thùng rác** đối với cảnh không cần thiết.

### Bước 3: Cấu hình ảnh và sinh nét vẽ cho từng cảnh (Cột bên phải)
Đối với mỗi cảnh được chọn:
1. **Ảnh phân cảnh**: Bấm **"Chọn ảnh..."** và trỏ đến file ảnh minh họa cho cảnh đó.
2. **Kịch bản nét vẽ (Annotation JSON)**:
   - Bấm nút **"Tạo Mẫu"**: Sidecar Python sẽ tự động phân tích ảnh, trích xuất các đường biên và cụm nét (contour/edge clusters), rồi sinh file `_annotation.json` tương ứng cùng thư mục với ảnh.
   - Giao diện sẽ hiển thị số nét vẽ tự động nhận diện được và gán sẵn tổng thời gian vẽ phù hợp với thời lượng cảnh.
3. **Tách vùng thông minh & Thứ tự vẽ (Component Ordering - Giai đoạn W4)**:
   - Khi bấm **"Tạo Mẫu"** (sinh Annotation JSON), thuật toán W4 sẽ tự động phân tích cấu trúc bố cục bức ảnh:
     - **Khung bao ngoài (Container)**: Các đường viền khung tranh hoặc hộp bao sẽ được ưu tiên vẽ trước.
     - **Hình minh họa chính (Illustration)**: Các chi tiết nhân vật/bối cảnh bên trong vẽ tiếp theo.
     - **Nhãn chữ chú thích (Text)**: Các dòng chữ được vẽ sau cùng theo thứ tự đọc tự nhiên (từ trên xuống, từ trái sang phải).
     - **Bảo toàn dấu tiếng Việt**: Dấu mũ, dấu sắc, hỏi, ngã, nặng được tự động gom nhóm chính xác với chữ cái tương ứng, không bị vẽ rời rạc hay bỏ sót.
     - **Không đứt nét viền**: Tránh hiện tượng trừ đè làm rỗng hoặc đứt nét viền ngoài của khung hình khi có chi tiết con nằm bên trong.
   - Giao diện hiển thị trực quan danh sách từng vùng vẽ nhận diện được (`sequence`, tọa độ `region`, thời gian `reveal`).
4. **Phong cách vẽ và Tô màu (Tự động nhận diện - Giai đoạn W3)**:
   - Khi bạn chọn ảnh cho phân cảnh, hệ thống sẽ **tự động phân tích đặc tính ảnh**:
     - *Nét đơn sắc (Line-Art)*: Hệ thống tự động chọn phong cách nét vẽ bám khung xương (`skeleton`), chuyển tô màu sang `Không tô (none)` và dồn 100% thời gian cho nét vẽ mượt mà, không lãng phí thời gian quét cọ thừa.
     - *Có mảng đen (Filled Mono)*: Tự động phối hợp vẽ viền (`grid`) + quét cọ mảng (`brush`).
     - *Ảnh màu (Colored)*: Tự động vẽ nét trước (`grid`) và quét màu theo đường viền (`contour-wipe`).
   - Bạn có thể chủ động thay đổi (ghi đè) phong cách nét vẽ hoặc kiểu tô màu ở khung **"Phong cách vẽ & Nhận diện ảnh"** theo ý thích.
4. **Thời lượng (Thời lượng cảnh, Thời gian vẽ, Giữ hình cuối cảnh)**:
   - Có thể điều chỉnh số mili-giây (ms) sao cho: `drawDurationMs + holdDurationMs <= durationMs`.

### Bước 4: Render kiểm tra từng phân cảnh lẻ
- Để kiểm tra xem cảnh vẽ có mượt mà, bàn tay di chuyển đúng ngòi bút hay không:
  - Bấm nút **"Render Thử Cảnh Này"**.
  - Theo dõi thanh tiến trình ở góc dưới.
  - Khi hoàn thành, bấm **"Xem Video Cảnh"** để mở file MP4 vừa render kiểm tra trước.

### Bước 5: Lưu dự án Whiteboard
- Bấm nút **"Lưu Dự Án"** trên thanh công cụ trên cùng.
- Chọn vị trí lưu file cấu hình (ví dụ: `du-an-vuon-dao.whiteboard.json`). File này lưu lại toàn bộ danh sách cảnh, đường dẫn ảnh, thời lượng và thông số để bạn có thể mở lại bất cứ lúc nào qua nút **"Mở Dự Án"**.

### Bước 6: Xuất toàn bộ video hoàn chỉnh (Ghép cảnh & Master Audio)
1. Bấm nút **"Xuất Toàn Bộ Dự Án"**.
2. Hộp thoại sẽ hỏi chọn:
   - **Nơi lưu file video xuất xưởng** (ví dụ `Video_Hoan_Chinh.mp4`).
   - **File âm thanh thuyết minh tổng thể (Master Audio)**: Chọn file `.wav` hoặc `.mp3` master audio (nếu có).
3. Ứng dụng sẽ tự động chạy:
   - Render tuần tự tất cả các phân cảnh theo cấu hình đã lưu.
   - Ghép nối liền mạch các video phân cảnh lại với nhau bằng FFmpeg mà không làm suy hao chất lượng.
   - Cắt/đồng bộ âm thanh thuyết minh master vào video tổng.
4. Khi hoàn tất, một thông báo xanh sẽ hiện ra cùng đường dẫn file video thành phẩm.

---

## 4. Các Tùy Chọn Nâng Cao

### Tùy chỉnh màu nền bảng vẽ (Paper Color)
- Mặc định là `#F5EBD7` (màu giấy ngà cổ điển, dịu mắt và tạo cảm giác vẽ tay ấm áp).
- Bạn có thể chỉnh sang `#FFFFFF` (trắng tinh khiết hiện đại) hoặc màu phấn bảng xanh `#1E3A2F` tùy theo chủ đề video.

### Tùy chỉnh bàn tay / bút vẽ
- File bút vẽ mặc định nằm tại: `sidecar-whiteboard/assets/drawing-hand.png`.
- Nếu bạn thay thế bằng ảnh của riêng mình:
  - Định dạng: **PNG 32-bit (với kênh Alpha trong suốt hoàn toàn)**.
  - Hướng ngòi bút: Đầu bút phải chấm đúng vào pixel mép trên-trái của bức ảnh hoặc bạn có thể chỉnh tọa độ offset trong `sidecar-whiteboard/scripts/render_stream_whiteboard.py`.

---

## 5. Xử Lý Các Vấn Đề Thường Gặp (Troubleshooting)

| Tình huống / Lỗi | Nguyên nhân | Cách khắc phục |
|---|---|---|
| Báo lỗi `ffmpeg: command not found` khi xuất toàn bộ | Máy tính chưa cài đặt FFmpeg hoặc FFmpeg không nằm trong PATH tiêu chuẩn | Cài đặt FFmpeg qua Homebrew (`brew install ffmpeg`). App đã hỗ trợ tự tìm tại `/opt/homebrew/bin/ffmpeg` và `/usr/local/bin/ffmpeg`. |
| Thời gian vẽ quá nhanh hoặc bị giật | `drawDurationMs` quá ngắn so với số lượng nét vẽ | Tăng thời lượng cảnh (`durationMs`) hoặc tăng `drawDurationMs` lên (khuyến nghị 15.000ms – 25.000ms mỗi cảnh). |
| Bàn tay vẽ bị khung màu đen quanh bút | File `drawing-hand.png` không phải nền trong suốt thật (vẫn còn ô ca-rô checkerboard hoặc nền đen) | Dùng phần mềm đồ họa (Photoshop, Figma, GIMP) xuất file PNG với suốt trong hoàn toàn (Transparency enabled). |
| Video xuất ra bị lệch giọng thuyết minh | File master audio có độ dài không khớp với tổng thời lượng các phân cảnh | Điều chỉnh lại thời lượng từng cảnh trong danh sách sao cho tổng các `durationMs` khớp với độ dài file audio. |

---

## 6. Tính Năng Đa Giọng Đọc (Character Bible) & Nhập Bộ Kịch Bản Whiteboard (.wb.json & .srt)

### 6.1. Đối thoại nhiều nhân vật trong Whiteboard
- **Cú pháp phụ đề**: Viết nhãn tên nhân vật ở đầu câu: `[Tên nhân vật]: Lời thoại` (ví dụ `[Thầy giáo]: Chào các em.`, `[Học sinh]: Chúng em chào thầy.`). Những câu không có nhãn sẽ tự động được coi là lời của **Người dẫn chuyện**.
- **Bảng phân vai Character Bible**:
  - Chuyển chế độ sang **"Theo nhân vật (N)"**.
  - Mỗi nhân vật có thể chọn 1 giọng đọc VieNeu riêng biệt (Nam/Nữ, Bắc/Trung/Nam).
  - Có nút **"Nghe"** để nghe thử từng giọng đọc trực tiếp.
  - Có thể thay đổi người nói cho từng câu cụ thể trong danh sách câu thoại của cảnh.

### 6.2. Nhập bộ kịch bản Whiteboard một/nhiều giọng (`.wb.json` & `.srt`)
Khi bạn sử dụng công cụ tạo kịch bản Whiteboard (`skill /wb`), hệ thống sẽ sinh ra 2 tệp đồng bộ: `<slug>.srt` và `<slug>.wb.json`.

- **Một giọng (schema 2):** mỗi mục SRT là một cảnh/ảnh. Chọn SRT rồi dùng **Nhập theo phân cảnh từ WB**; preview hiện số cảnh và **Một giọng**, giữ giọng bạn đã chọn. Không cần đổi schema hoặc bổ sung bảng nhân vật vào JSON.
- **Nhiều giọng (schema 3):** một cảnh có thể chứa nhiều lượt nói; import giữ nhóm cue và bảng phân vai từ JSON.
- Ví dụ bộ “Đổng Trác uống trà” schema 2 được nhập thành **3 cảnh, 3 cue, 94 giây**; gán `1.png`, `2.png`, `3.png` cho ba cảnh rồi tạo TTS bằng một giọng chung. Thời lượng sau tự căn có thể thay đổi theo audio thực.
- Preview không thay nội dung dự án. Nếu đã có cảnh, cần đánh dấu đồng ý thay cảnh; hãy lưu trước nếu muốn giữ chỉnh sửa. Khi áp dụng, ứng dụng kiểm tra lại cả hai file; import thành công xóa audio/video cũ cần tạo lại.
- Nếu không nhập được, thông báo phân biệt **định dạng chưa hỗ trợ**, **cấu trúc metadata sai** và **SRT/metadata không khớp**. Chỉ đổi số `schema_version` không chuyển đổi được định dạng file.

1. **Tự động nhận diện khi chọn file SRT**:
   - Khi bạn bấm **"Chọn"** và chọn tệp `.srt`, nếu có tệp `.wb.json` cùng tên ở cùng thư mục, ứng dụng sẽ tự động mở hộp thoại **"Phát hiện kịch bản Whiteboard đồng bộ (.wb.json)"**.
2. **Nút "Kịch bản WB"**:
   - Bạn cũng có thể bấm trực tiếp nút **"Kịch bản WB"** cạnh nút "Chia Cảnh" để mở bảng xem trước và nhập lại kịch bản.
3. **Bảo toàn nguyên tắc 1 cảnh = 1 bức vẽ**:
   - Khác với nút "Chia Cảnh" tự động cắt phụ đề theo thời gian 25–35 giây, tùy chọn **"Nhập theo phân cảnh từ WB (Khuyên dùng)"** sẽ giữ nguyên cấu trúc cảnh kịch bản đã định nghĩa: **Một cảnh duy nhất (dùng 1 bức tranh vẽ) có thể chứa 2–3 câu thoại đối đáp qua lại giữa các nhân vật**.
4. **Kiểm tra tính toàn vẹn (SHA-256)**:
   - Hệ thống tự động so khớp mã băm SHA-256 của tệp phụ đề với bản ghi trong kịch bản. Nếu tệp phụ đề bị sửa lệch bên ngoài, ứng dụng sẽ cảnh báo rõ ràng để tránh sai lệch đồng bộ audio và hình ảnh.

### 6.3. Nạp ảnh từ thư mục và tạo mẫu annotation hàng loạt

Từ phiên bản v0.8.1, bạn không còn phải chọn từng ảnh và tạo mẫu nét vẽ thủ công từng cảnh một:

1. **Nạp ảnh thư mục (`1.png`, `2.jpg`, `3.png`...)**:
   - Bấm nút **"Nạp ảnh thư mục"** ở thanh công cụ danh sách phân cảnh.
   - Chọn thư mục chứa ảnh. Ứng dụng tự động quét và map tên file theo số nguyên dương của stem (`1`, `2`, `10`... khớp đúng cảnh #1, #2, #10).
   - Tự động phát hiện ảnh bìa ứng viên (`thumb.png`, `thumbnail-9x16.png`...).
   - Bảng xem trước cho phép:
     - Chọn chỉ điền cảnh chưa có ảnh (mặc định) hoặc thay ảnh cả cảnh đã có.
     - Chọn giải quyết ảnh bị trùng số thứ tự (ví dụ có cả `1.png` và `01.jpg`).
     - Tùy chọn sử dụng ảnh bìa hoàn chỉnh (Imported - không phủ chữ) hoặc làm ảnh minh họa để ghép chữ.
   - Bấm **"Áp dụng"**: toàn bộ ảnh được gán vào đúng các cảnh trong một thao tác duy nhất.

2. **Tạo mẫu tất cả (Batch Annotation)**:
   - Sau khi tạo TTS và tự căn timing, bấm **"Tạo mẫu tất cả"**.
   - Tùy chọn:
     - **Chỉ tạo mẫu còn thiếu** (Khuyến nghị): Chỉ sinh nét vẽ cho các cảnh chưa có annotation, giữ nguyên các cảnh bạn đã tinh chỉnh vùng vẽ thủ công.
     - **Tạo lại toàn bộ các cảnh có ảnh**: Tính toán lại nét vẽ cho mọi cảnh.
   - Hệ thống xử lý tuần tự từng cảnh với mốc thời gian cue tương đối chính xác, hiển thị tiến độ và có nút **"Dừng sau cảnh hiện tại"**.

3. **Chế độ ảnh bìa hoàn chỉnh (Imported Thumbnail)**:
   - Với những ảnh bìa đã thiết kế đồ họa hoàn chỉnh kèm chữ (ví dụ xuất từ Canva, Photoshop), bạn có thể nạp trực tiếp qua tính năng nạp thư mục hoặc nút **"Nhập bìa hoàn chỉnh"** trong tab Thumbnail.
   - Ứng dụng tự động chuẩn hóa tỷ lệ 16:9 (1280×720) hoặc 9:16 (720×1280) và chèn nguyên bản vào 2 giây đầu của video khi xuất mà không cần phủ đè thêm tiêu đề Fabric.js.



