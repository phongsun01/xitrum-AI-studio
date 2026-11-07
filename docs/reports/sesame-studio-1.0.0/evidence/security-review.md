# Rà soát tĩnh: bảo mật, mạng và lưu trữ Sesame Studio 1.0.0

Phạm vi: mã được trích xuất từ bộ cài, không chạy ứng dụng, không truy cập endpoint. Mọi `file:line` dưới đây tính từ `extracted/resources/app/`. Đây là bằng chứng đọc mã bằng shell, không phải Evidence do REA tạo. Các nhận định khả năng tác động là suy luận tĩnh, chưa xác nhận khai thác thực tế.

## 1. Electron và ranh giới IPC

**Quan sát:** `main.js:412–428` tạo BrowserWindow với preload cố định, `contextIsolation: true`, `nodeIntegration: false`; `main.js:468` nạp `ui/index.html` cục bộ. Đây là biện pháp giảm quyền renderer có thật trong cấu hình mã. `preload.js:189–190` xuất cùng API dưới `window.sesame` và `window.electronAPI`, bao gồm thao tác file, tài khoản, token, render và cài thư viện.

**Điểm cần gia cố — quyền IPC rộng, phụ thuộc renderer đáng tin:** `preload.js:131` xuất `deleteFile(filePath)`; handler `main.js:629–638` chỉ kiểm tra đường dẫn tồn tại rồi `fs.unlinkSync(filePath)`, không giới hạn trong thư mục output hay xác nhận bằng hộp thoại. `preload.js:173` xuất `toolkitTtsReadTxt(filePath)`; `main.js:1441–1447` đọc UTF-8 của mọi đường dẫn tồn tại và trả toàn bộ text, không kiểm tra phần mở rộng hay phạm vi thư mục. Trong các handler được xem, tham số sự kiện `_e`/`_event` bị bỏ qua; không thấy kiểm tra `senderFrame`/URL người gọi. Tìm trên toàn bộ JS/HTML trích xuất cũng không thấy `setWindowOpenHandler`, `will-navigate` hoặc CSP trong `ui/index.html`.

**Suy luận:** nếu renderer bị chèn script hoặc bị điều hướng sang nội dung không tin cậy trong cùng webContents, API bridge có thể cho script đó đọc/xóa file trong quyền người dùng. Đây là điều kiện hậu khai thác, **chưa chứng minh có đường XSS hoặc điều hướng tự động từ Internet tới handler**. Không thể từ IPC này kết luận máy có thể bị truy cập từ xa. Cần xác minh phiên bản Electron, chính sách mặc định và thử runtime trước khi chốt mức độ lỗ hổng. UI có hàm `escapeHtml` thật tại `ui/app.js:12–14`; nhiều phần hiển thị dùng hàm này, nên không được mặc định tất cả `innerHTML` đều là XSS.

## 2. Local CRM API

**Quan sát:** ứng dụng gọi `crmServer.start()` khi ready (`main.js:522–544`). Server bind chính xác `127.0.0.1:48900` (`engine/crm-server.js:145`), không bind mọi card mạng. API v1 kiểm tra API key tại dòng 77–78; so sánh bằng `crypto.timingSafeEqual` tại 40–43. Key được tạo từ 20 byte ngẫu nhiên (`main.js:403–409`). Body giới hạn khoảng 40 MiB ở `engine/crm-server.js:46–53` (đo độ dài chuỗi, không phải bộ đếm byte chính xác).

**Điểm cần sửa — API cũ bỏ qua xác thực:** `GET /api/status`, `POST /api/render`, `GET /api/videos` được xử lý tại `engine/crm-server.js:62–75`, trước nhánh kiểm tra key. POST render gọi `onJobReceived(data)` mà chỉ yêu cầu có prompt; callback tại `main.js:530–532` chuyển trực tiếp thành `submitTask`. Server đồng thời trả `Access-Control-Allow-Origin: *`, cho GET/POST/DELETE/OPTIONS và chấp nhận preflight (`engine/crm-server.js:124–134`), không kiểm tra Origin/Host.

**Suy luận:** tiến trình cục bộ không cần key có thể gửi prompt vào hàng đợi; có thể tiêu thụ lượt AI/tài nguyên nếu account và queue đang hoạt động. Một trang web ngoài cũng có cơ hội gọi/đọc API cũ khi chính sách truy cập loopback/private-network của trình duyệt cho phép; CORS của server không ngăn nó. Chưa chạy trình duyệt để xác nhận điều kiện này. Cách khắc phục: yêu cầu key cho API cũ hoặc tắt mặc định, giới hạn Origin/Host, thêm giới hạn tần suất và kiểm soát nguồn submit. Không mô tả API là public Internet vì bind loopback.

## 3. Token và dữ liệu trên ổ đĩa

**Quan sát:** `engine/config-manager.js:13–15` dùng userData/user_config.json; defaults chứa `fbToken`/`selectedPageAccessToken` (28–32); save ghi JSON thuần (38–42). Riêng cấu hình Facebook đang dùng bởi IPC nằm tại `facebook-config.json`: `main.js:1049–1067`; đọc token/config trả cho renderer tại 1074–1078. Account API key, proxy có thể gồm username/password được giữ nguyên dạng chuỗi tại `engine/accounts.js:21,31,34`; `flush()` ghi JSON vào `accounts.json.tmp` rồi rename (`77–82`). Không thấy gọi Electron safeStorage hoặc mã hóa ở các đường ghi này. `engine/chrome.js:83–96` chạy Chrome với profile riêng qua `--user-data-dir`, giữ phiên đăng nhập ở profile; không dùng profile chính.

**Suy luận:** bản sao lưu/sao chép userData hoặc phần mềm chạy cùng quyền người dùng có thể đọc khóa ứng dụng/API và proxy; khả năng đọc cookie Chrome còn tùy mã hóa của Chrome/OS, không kết luận toàn bộ cookie là plaintext. Nên dùng kho bí mật của OS, che token khi trả config và tách cấu hình không nhạy cảm khỏi token. Review này không thấy key thật của người dùng trong bundle và không đọc thư mục userData ngoài target.

## 4. Dữ liệu ra dịch vụ bên ngoài

Các đường gọi dưới đây có code tạo request, không chỉ là tên/logo. Chúng chứng minh khả năng gửi dữ liệu nếu nhánh được gọi; không chứng minh đã gửi trên máy người dùng.

| Đích trong mã | Dữ liệu/luồng | Mốc bằng chứng |
| --- | --- | --- |
| `muse.ai`, `flow.google.com`, `ai.byteplus.com`, `www.dola.com` | Chrome account riêng; điều khiển qua CDP để dùng dịch vụ | `main.js:158–161`; `engine/chrome.js:124,131–144`; `engine/seedance-runner.js:31`; `engine/dola-runner.js:41–42` |
| `ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks` | Tạo task Seedance, gửi content, poll kết quả | `engine/seedance-runner.js:462–480` |
| `api.openai.com/v1/chat/completions` | Nội dung phụ đề trong prompt, Bearer API key | `engine/toolkit/toolkit-translator.js:147–181`; `engine/ipc-review.js:42` |
| `generativelanguage.googleapis.com` | Prompt/phụ đề cho Gemini, key trong query | `engine/toolkit/toolkit-translator.js:160–168`; `engine/ipc-review.js:30,48` |
| `graph.facebook.com/v20.0` | Facebook token ở query, liệt kê Page; upload/publish Reel | `engine/facebook-poster.js:51–59,135,169` |
| `translate.googleapis.com/translate_a/single` | Văn bản cần dịch nằm trong query `q` | `engine/sesame-core.js:196–204` |
| `translate.google.com/translate_tts` | Văn bản TTS trong query | `engine/toolkit/tts-sources.js:48–51` |
| `www.tikwm.com/api/` | URL TikTok/Douyin do người dùng nhập, lấy URL media trả về để tải | `engine/sesame-core.js:1408–1423` |
| `fonts.googleapis.com`, `fonts.gstatic.com` | Nạp Google Font cho UI | `ui/index.html:8–10` |

Người dùng cần hiểu tính năng AI/dịch/TTS trực tuyến có thể gửi prompt, văn bản hoặc ảnh/video cho nhà cung cấp. Không có bằng chứng runtime về payload thực tế, nơi lưu trên server, telemetry hoặc chính sách riêng tư của những dịch vụ đó.

## 5. URL, tiến trình phụ và chuỗi cung ứng

**Quan sát:** `fetch-image-base64` nhận URL từ renderer (`preload.js:98`), dùng `http/https.get` rồi ghép toàn bộ response vào bộ nhớ (`main.js:1158–1171`), không thấy chặn địa chỉ private/loopback, giới hạn số byte hay xác minh MIME ảnh. `fetchImageAsDataUrl` còn theo redirect đệ quy (`main.js:325–345`); Ladi crawler cũng theo redirect và tích lũy toàn bộ HTML (`engine/ladi-crawler.js:10–43`). **Suy luận:** renderer/input đáng tin đang là ranh giới bảo vệ; nếu nhận URL không đáng tin, các đường này có thể truy cập dịch vụ nội bộ hoặc dùng quá nhiều bộ nhớ. Chưa xác minh đường input từ xa tới những lời gọi đó và không gọi thử URL nào.

Phần lớn lệnh media dùng `spawn`/`execFile` với mảng tham số, không tạo shell command trực tiếp (ví dụ `main.js:1393`, `engine/ipc-tools.js:13,182–189`). Đây là giảm nguy cơ shell injection, không phải bảo đảm không có lỗi ở FFmpeg/yt-dlp hay argument parsing. Windows có đoạn PowerShell ghép `profileDir` vào script (`engine/chrome.js:20–30`); review chưa xác nhận nguồn input có thể điều khiển profileDir để khai thác. Chrome CDP dùng pipe, không mở cổng debug mạng ở đường `engine/chrome.js:83–96`; cổng debug Electron chỉ được bật khi có biến môi trường/flag (`main.js:23–29`).

Trung tâm tài nguyên có IPC cài `edge-tts`, `yt-dlp`, `vieneu` bằng `pip install --user` không pin version/hash (`engine/ipc-tools.js:225–239`). Đây là hành vi cài dependency theo yêu cầu tính năng, không phải bằng chứng mã độc, nhưng kết quả cài phụ thuộc Python/PATH và chỉ mục pip hiện hành. Review không chạy những lệnh này.

**Lưu ý độ chính xác chức năng:** downloader `engine/ipc-tools.js:172–219` thử yt-dlp, sau đó có nhánh copy ngẫu nhiên một video mẫu đã có tại output và trả `ok:true, method:'clean-stream'` (213–216). Thành công ở nhánh này không chứng minh video lấy từ URL người dùng. Cần ghi rõ là fallback/demo trong UI.

## 6. Những điều chưa kết luận

Không xác nhận app an toàn hay mã độc; không kiểm tra động network, hành vi cài NSIS, registry, task startup, signer trust, exploitability, lỗ hổng dependency hay toàn bộ binary helper. Không thấy kỹ thuật mã hóa dữ liệu nhạy cảm ở các đường lưu đã đọc không đồng nghĩa kiểm toán toàn bộ phần mềm. Ưu tiên chỉnh API cũ không key, ranh giới IPC/đường dẫn file, bảo vệ secret và minh bạch dữ liệu gửi ra ngoài.
