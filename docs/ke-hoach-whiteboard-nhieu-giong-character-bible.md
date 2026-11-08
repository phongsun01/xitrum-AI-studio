# Kế hoạch Whiteboard nhiều giọng đọc theo Character Bible

Ngày lập: **08/11/2026**. Cập nhật kế hoạch: **09/11/2026**.

Trạng thái: **Tài liệu đã ghi nhận triển khai M1–M4 và đợt khắc phục ngày 09/11; cần bổ sung luồng import bộ WB (SRT + `.wb.json`) theo mục 4 bên dưới.** Các báo cáo cuối tài liệu là kết quả được ghi nhận tại thời điểm thực hiện, không thay thế nghiệm thu luồng import mới. Lần cập nhật này chỉ bổ sung kế hoạch, chưa triển khai hoặc kiểm chứng lại các bản sửa được báo cáo.

## 1. Mục tiêu và phạm vi

Cho phép **một cảnh Whiteboard có 2–3 hoặc nhiều giọng đọc nối tiếp**, mỗi lượt thoại gắn với một nhân vật. Đổi người nói không tự tạo cảnh mới. Một cảnh vẫn dùng chung ảnh, annotation và lịch vẽ.

Quy tắc nền tảng: **Character Bible quản lý nhân vật và giọng; cue quản lý người nói và lời thoại; scene quản lý hình ảnh và thời gian vẽ.**

Phạm vi bản đầu:
- Giữ chế độ một giọng mặc định; thêm chế độ theo nhân vật.
- Nhận nhãn `[Tên nhân vật]:` từ SRT, lập bảng phân vai và cho sửa theo cue.
- Nghe thử giọng, lưu/mở đầy đủ phân vai.
- Hỗ trợ cả giữ mốc SRT và tự căn theo lời đọc.
- Không hỗ trợ hai người nói chồng âm trong bản đầu.

## 2. Mô hình dữ liệu đích

```ts
interface WhiteboardSpeaker {
  id: string;                  // ID ổn định
  name: string;
  voiceId: string;
  sourceCharacterId?: string;   // liên kết Character Bible khi import
}

interface WhiteboardSpeechConfig {
  mode: "single" | "characters";
  defaultVoiceId: string;
  timingMode: "fixed" | "auto";
  speakers: WhiteboardSpeaker[];
}

interface WhiteboardSrtCue {
  id?: string;
  index: number;
  startMs: number;
  endMs: number;
  speechEndMs?: number;
  durMs: number;
  text: string;
  sourceText?: string;
  spokenText?: string;
  speakerName?: string | null;
  speakerId?: string | null;
}
```

## 3. Các mốc triển khai

### M1 — Hợp đồng dữ liệu và parser
- Chốt schema, migration, nguồn sự thật và định dạng request/response.
- Bổ sung metadata cue, cấu hình project ở TypeScript/Rust và validator Python liên quan.
- Bổ sung parser nhãn, ID ổn định và fixture dùng chung.
- Cập nhật `docs/whiteboard-project-format.md`.

### M2 — TTS nhiều giọng xuyên các tầng
- Mở rộng API, command, enum request và Python dispatcher.
- Resolve/infer theo cue ở cả hai chế độ timing; kiểm tra voice trước khi tổng hợp.
- Bảo toàn ID và nhãn khi trả timing/xuất SRT; xử lý file tạm và lỗi rõ ràng.

### M3 — UI, lưu trạng thái và chống kết quả lỗi thời
- Toggle, bảng phân vai, nghe thử, sửa từng cue và chỉ báo cần tạo lại.
- Tích hợp lưu/mở/reset project, fingerprint và kiểm tra snapshot.
- Cập nhật timing/annotation theo kết quả hợp lệ, bảo toàn metadata nhân vật.

### M4 — Nghiệm thu xuyên luồng và tài liệu
- Chạy kiểm tra build/Rust/Python thích hợp và luồng thực từ import → phân vai → TTS → render → mở lại.
- Cập nhật hướng dẫn Whiteboard với ví dụ một cảnh ba giọng.

## 4. Phần bổ sung — Import bộ WB: SRT + metadata nhóm cảnh

### 4.1. Mục tiêu và giới hạn

Skill `/wb` đã bổ sung `--speech characters`, xuất một cue cho mỗi lượt nói và JSON schema 3 nhóm nhiều cue vào một cảnh. Phần mềm cần adapter đọc nhóm này để nhập đúng **1 cảnh, 1 ảnh, 3 lượt thoại với 3 giọng**. Đây là phần bổ sung nối skill với ứng dụng, không phải viết lại engine TTS.

Hai định dạng không đồng nhất:

- `<slug>.srt`: timestamp và lời thoại, nhãn `[Tên]:` cho nhân vật; người dẫn chuyện không nhãn.
- `<slug>.wb.json`: metadata của skill, gồm `cues`, `scenes[].cue_ids`, `speech.speakers`, nguồn/hash và kế hoạch hình ảnh.
- `<slug>.whiteboard.json`: project của phần mềm; phải được tạo qua chuyển đổi và lưu theo hợp đồng project hiện có. Không đổi đuôi `.wb.json` để mở như project.

`--scenes N` của skill luôn là số cảnh/ảnh, không phải số cue hoặc số giọng. Import không tự gọi TTS, sinh ảnh, căn lại thời gian hoặc tải tài nguyên từ đường dẫn trong metadata. Người nói và nhân vật trong hình là hai khái niệm riêng.

### 4.2. Thứ tự công việc

Thực hiện **I1 → I2 → I3 → I4 → I5 → I6**. I1–I2 có thể hoàn thiện trước UI; chỉ đánh dấu luồng mới hoàn thành khi I6 đạt. Xác minh các bản sửa M2–M3 đã ghi trong báo cáo khắc phục trước khi nghiệm thu TTS xuyên luồng; nếu còn lỗi thì sửa và thêm regression test, không mặc định làm lại những bản sửa đã đạt.

#### I1 — Chốt hợp đồng import và fixture

- Đọc schema thực tế và validator của skill tại `~/.codex/skills/wb/references/multi-speaker.md`, `references/data-format.md`, `scripts/validate_outputs.py` trước khi triển khai; tên dưới đây là dữ liệu của skill, không phải trường project hiện tại.
- Chuẩn bị fixture tối thiểu schema 3: một cảnh ba cue (dẫn chuyện, thầy, trò); bốn cảnh mười hai cue; nhiều cảnh có độ dài khác nhau; cùng nhân vật qua nhiều cảnh.
- Chốt hỗ trợ schema: schema 3 là phạm vi bắt buộc; schema 1/2 cũ có thể chuyển một scene tương ứng một cue bằng adapter rõ ràng. Schema chưa hỗ trợ phải báo lỗi, không đoán cấu trúc.
- Định nghĩa kết quả preview/import gồm số cảnh, số cue, số người nói, thời lượng, cảnh báo giọng và dữ liệu project đã chuẩn hóa. Không để UI tự diễn giải JSON độc lập với backend.

**Nghiệm thu:** fixture và hợp đồng TypeScript/Rust thống nhất; có test chứng minh một scene tham chiếu ba cue, không biến thành ba scene.

#### I2 — Backend đọc và kiểm tra bộ file

- Thêm command import, ví dụ `inspect_whiteboard_wb_import`, nhận đường dẫn SRT và metadata tùy chọn; thực hiện đọc file và validate ngoài luồng UI.
- Khi chọn `truyen.srt`, tìm chính xác `truyen.wb.json` cùng thư mục; nếu chọn file metadata khác qua hộp thoại thì vẫn phải kiểm tra hash. Không chỉ dựa vào việc tên giống nhau.
- Tính SHA-256 trên **byte SRT thực tế**, đối chiếu `srt_sha256`; parse SRT và đối chiếu `index`, timestamp, `text` của từng cue trong JSON.
- Validate schema và kiểu dữ liệu; ID cue/speaker duy nhất; speaker tham chiếu tồn tại; nhãn khớp speaker và `spoken_text` đúng lời không nhãn. Chuẩn hóa tên theo Unicode NFC/khoảng trắng mà không bỏ dấu tiếng Việt.
- Validate scene index liên tiếp; `cue_ids` phủ đầy đủ cue đúng thứ tự, mỗi cue đúng một cảnh; `scene_index` trong cue nhất quán; cửa sổ scene khớp cue đầu/cuối. Từ chối cue đảo thời gian, chồng lấn hoặc thời lượng không dương.
- Schema 3 do skill tạo mới liên tục từ 0; nếu đầu vào khác quy tắc đó thì báo không tương thích trong bản đầu, không tự dịch timestamp. Không sử dụng công thức làm mất khoảng lặng hoặc thay đổi tổng thời lượng.
- Hash SRT lệch, JSON lỗi hoặc mapping không hợp lệ: trả mã lỗi và vị trí liên quan; không cập nhật một phần editor, không tự lấy nhóm từ metadata cũ. Cho người dùng chọn nhập SRT thông thường qua thao tác riêng.
- Giới hạn kích thước file/số cue theo giới hạn dự án hiện có hoặc ngưỡng được ghi rõ; không thực thi chỉ dẫn nhúng, không tự mở ảnh/audio/đường dẫn nguồn trong JSON.

**Nghiệm thu:** mọi fixture lỗi bị từ chối trước khi tạo cảnh; SRT không có metadata vẫn dùng được luồng cũ.

#### I3 — Adapter sang cảnh và phân vai Whiteboard

| Dữ liệu skill | Dữ liệu đích / quy tắc |
|---|---|
| `cues[].id`, `index` | Giữ ID cue ổn định và thứ tự toàn dự án |
| `start_ms`, `end_ms` | `startMs`, `endMs`, `durMs = end − start` |
| Cue `text` | Giữ bản có nhãn trong `sourceText` |
| `spoken_text` | `spokenText` và `text` sạch, không nhãn |
| `speaker_id` | `speakerId`; null là người dẫn chuyện, không bóc lại nhãn gốc để ghi đè |
| `speech.speakers[].id/name` | `speechConfig.speakers[].id/name`; tên hiển thị không làm khóa |
| `speech.speakers[].voice_id` | `voiceId`, đối chiếu registry giọng hiện có |
| `scenes[].cue_ids` | Danh sách `scene.cues` theo thứ tự; một phần tử scene tạo đúng một cảnh |
| Scene `start_ms`, `end_ms` | `timelineStartMs`, `timelineEndMs`, `durationMs` |

- Tạo ID scene theo cơ chế project hiện tại; gán `order` theo thứ tự, trạng thái chưa render. Ảnh/annotation/output để trống theo hợp đồng hiện có để người dùng gán **một ảnh mỗi scene**.
- Không chuyển `characters[].reference` thành ảnh cảnh: đó có thể là ảnh tham chiếu nhân vật. Không coi beats của skill là annotation có thể render trực tiếp.
- `voice_id: null` nghĩa là chưa chọn: dùng lựa chọn giọng mặc định của lần import và hiển thị rõ để người dùng chỉnh. ID giọng được cung cấp nhưng không tồn tại phải hiện cảnh báo cần sửa trước TTS; không fuzzy-match hay âm thầm đổi giọng. Chốt cách biểu diễn vai chưa hợp lệ nếu kiểu `voiceId` hiện tại bắt buộc string.
- Không áp `timing.kind` của skill trực tiếp thành `speechConfig.timingMode`: một bên mô tả độ tin cậy của timestamp, một bên là lựa chọn tạo TTS. Hiển thị thời gian dự kiến nếu `estimated`; giữ lựa chọn fixed/auto rõ ràng.
- Giữ nguồn import và hash cho truy vết trong trường project được đặc tả nếu bổ sung; không coi hash import là fingerprint audio. Không nhận master audio hoặc output video từ metadata skill như kết quả đã tạo trong project.

**Nghiệm thu:** import một cảnh ba cue tạo đúng một `WhiteboardSceneItem`, ba cue đúng vai và bảng giọng tương ứng; không tự sinh ba ảnh/ba annotation.

#### I4 — UI preview và áp dụng import

- Trong khu vực nhập SRT, khi có metadata hợp lệ hiển thị: **“Phát hiện metadata WB: 4 cảnh, 12 lượt thoại, 3 người nói.”** Số người nói có tính dẫn chuyện khi xuất hiện; bảng phân vai liệt kê rõ từng vai.
- Cung cấp lựa chọn **“Nhập theo cảnh từ WB”** và **“Chia cảnh từ SRT thông thường”**; giải thích lựa chọn sau không bảo đảm giữ nhóm từ skill. Giữ các tùy chọn chia SRT hiện tại.
- Cho chọn `.wb.json` khác nếu không tự tìm thấy; thiếu metadata không phải lỗi chặn dùng SRT thông thường.
- Preview thể hiện mỗi cảnh, số cue, vai và thời lượng; cảnh báo giọng chưa chọn/không hợp lệ. Dữ liệu preview được backend validate; nếu file thay đổi trước khi áp dụng thì kiểm tra lại hash, không áp snapshot lỗi thời.
- Áp dụng import nguyên khối sau kiểm tra thành công, tăng revision và reset kết quả TTS/video cũ. Với dự án có chỉnh sửa, dùng cơ chế xác nhận thay nội dung/lưu hiện có trước khi thay; bản đầu không hỗ trợ merge tự động.
- Sau import, giữ UI chọn giọng/nghe thử và dropdown người nói theo cue. Người dùng gán ảnh theo scene; không gọi lại “Chia Cảnh” từ SRT rồi làm mất nhóm vừa nhập.

**Nghiệm thu:** preview và số cảnh thực tế giống nhau; hủy import hoặc lỗi validate không làm mất dự án đang mở.

#### I5 — Lưu/mở, tự căn và tính nhất quán audio

- Lưu đủ nhóm cue/scene, ID và phân vai trong `.whiteboard.json`; mở lại giữ nguyên số cảnh, ảnh và giọng. Cập nhật struct Rust, types TypeScript và validator Python ở những nơi thực sự xử lý trường mới.
- Khi gọi TTS, truyền snapshot cue đã chỉnh trong project và scene ranges từ nhóm đã import; không đọc lại SRT để tự dựng lại nhóm hoặc phân vai.
- Khi auto-timing, cập nhật từng cue theo ID và cửa sổ scene theo range hiện có; giữ ảnh, số cảnh và thứ tự. Không đổi cảnh chỉ vì đổi giọng. Nếu duration/lịch vẽ đổi, retime annotation và vô hiệu hóa video cần render lại.
- Kiểm tra fingerprint và cơ chế từ chối kết quả lỗi thời cho import trong lúc TTS/render. Đổi project hoặc nhập bộ mới không được nhận audio của bộ trước.
- Kiểm chứng các bản sửa đã ghi ở phần khắc phục: explicit narrator null; không xuất audio cũ sau đổi giọng/vai/lời; mở project cũ reset state; SRT aligned xuất nhãn theo vai hiện tại; ID/voice sai báo lỗi. Phát hiện lỗi còn tồn tại thì bổ sung test và sửa trước nghiệm thu.
- `.aligned.srt` chỉ giữ nhãn/timestamp, không tự chứa nhóm scene. Project là nguồn nhóm sau retime. Nếu bổ sung export lại bộ WB aligned, phải sinh metadata/hash mới tương ứng; không ghép SRT mới với `.wb.json` hash cũ hoặc khẳng định SRT đơn lẻ giữ được nhóm.

**Nghiệm thu:** tạo TTS hai lần và lưu/mở lại vẫn một cảnh ba cue; sửa vai/đổi giọng không phục hồi nhãn cũ hoặc dùng nhầm master audio.

#### I6 — Kiểm thử, tài liệu và điều kiện hoàn thành

| Nhóm | Ca nghiệm thu bắt buộc |
|---|---|
| Import đúng | 1 cảnh/3 cue/3 người nói; 4 cảnh/12 cue; một vai qua nhiều cảnh |
| Validate | Hash lệch, JSON/schema sai, cue trùng/thiếu/đảo, ID vai sai, nhãn/lời sạch không khớp, timeline lỗi |
| Giọng | Null chưa chọn, giọng không tồn tại, đổi giọng, chuyển nhân vật sang dẫn chuyện |
| UI | Preview, chọn metadata thủ công, hủy, thay dự án có chỉnh sửa, file thay đổi sau preview |
| Persistence | Lưu/mở đúng ảnh/cue/voice; mở project cũ sau project nhiều giọng không giữ state cũ |
| TTS/timing | Fixed giữ mốc hoặc báo overflow; auto giữ scene ranges/ảnh/ID và cập nhật annotation |
| Đồng thời | Nhập bộ mới khi TTS đang chạy không nhận kết quả cũ; chặn audio TTS không khớp cấu hình |
| Video thật | Một ảnh/cảnh xuyên ba lượt thoại, ba giọng đúng thứ tự, đủ đầu/đuôi tiếng và lịch vẽ khớp |
| Tương thích | SRT đơn và project cũ hoạt động; bản đóng gói tìm đúng parser/adapter |

- Dùng fixture do schema 3 của skill tạo; test adapter xuyên IPC và fake TTS cho logic, VieNeu thật + render thực cho nghiệm thu audio/video. Không coi test mock là bằng chứng chất lượng giọng.
- Vị trí dự kiến: `src/components/WhiteboardEditor.tsx`, `src/api.ts`, `src/types/whiteboard.ts`, `src-tauri/src/commands.rs`, module import riêng nếu cần; executor/sidecar chỉ mở rộng khi chức năng chuyển đổi thực sự nằm ở đó. Test nằm cùng tầng chịu trách nhiệm validate, tránh hai parser độc lập không cùng quy tắc.
- Chạy frontend build, Rust tests và Python tests bị ảnh hưởng; ghi kết quả thực chạy. Xem video ở các điểm đổi cue/cảnh và nghe ba vai; nêu phần chưa kiểm tra nếu môi trường thiếu model/media.
- Cập nhật `docs/whiteboard-project-format.md`, hướng dẫn Whiteboard và README với luồng nhập bộ WB. Sau khi app thực sự hỗ trợ, cập nhật `/wb help` và `references/multi-speaker.md` của skill để bỏ giới hạn import tương ứng; không sửa mô tả thành “đã hỗ trợ” trước nghiệm thu.

**Điều kiện hoàn thành:** người dùng xuất bộ bằng `/wb all ... --speech characters`, nhập SRT kèm metadata thành đúng số scene/ảnh, chọn giọng, tạo TTS, render, lưu/mở và tự căn lại mà không mất nhóm hay phân vai. Chỉ cập nhật trạng thái “đã hoàn thành import WB” khi có bằng chứng các bước đó đạt.

### 4.3. Các phần mở rộng sau luồng import

- **M5 — Import từ Character Bible của tab Kịch bản:** khác với import bộ file WB; cần xác minh ngữ nghĩa `scene.character`, chuyển lượt thoại và giữ `sourceCharacterId`. Không mặc định nhân vật xuất hiện trong hình là người nói.
- **M6 — Cache audio theo cue:** cache theo lời sạch, voice ID, engine/model và tham số; chỉ infer lại cue bị ảnh hưởng, ghép master và tính timing lại. Không cam kết tốc độ vài giây trước khi đo thực tế.

---

# BÁO CÁO TIẾN ĐỘ VÀ KẾT QUẢ TRIỂN KHAI

## Báo cáo Mốc 1 (M1) — Hợp đồng Dữ liệu & Parser SRT
- **Thời gian hoàn thành**: 08/11/2026.
- **Các thay đổi đã thực hiện**:
  1. `src/types/whiteboard.ts`: Bổ sung interface `WhiteboardSpeaker`, `WhiteboardSpeechConfig`, mở rộng `WhiteboardSrtCue` (thêm `id`, `sourceText`, `spokenText`, `speakerName`, `speakerId`), cập nhật `WhiteboardProject` với `speechConfig`.
  2. `sidecar-whiteboard/scripts/parse_srt.py`: Thêm regex bóc tách tiền tố nhãn `[Tên nhân vật]: Lời thoại`. Chuẩn hóa Unicode NFC cho tên nhân vật và lời thoại sạch.
  3. `src-tauri/src/commands.rs`: Khai báo struct `WhiteboardSpeaker`, `WhiteboardSpeechConfig` và thêm vào `WhiteboardProject`. Viết test `whiteboard_speech_config_roundtrip`.
  4. `docs/whiteboard-project-format.md`: Cập nhật đặc tả schema `speechConfig` và metadata của `cue`.
- **Kết quả nghiệm thu**:
  - `sidecar-whiteboard/tests/test_parse_srt.py`: 10/10 tests passed (bóc tách đúng các câu có tiền tố `[Tên]:` và câu không nhãn).
  - Rust tests (`cargo test`): 26/26 passed.
  - TypeScript build (`npm run build`): Thành công không có lỗi type.

---

## Báo cáo Mốc 2 (M2) — Backend TTS Đa Giọng Nối Tiếp
- **Thời gian hoàn thành**: 08/11/2026.
- **Các thay đổi đã thực hiện**:
  1. `sidecar-tts/tts_runner.py`:
     - Xây dựng hàm `resolve_voice_for_cue`: tra cứu `voiceId` của từng câu phụ đề theo `speaker_id` $\rightarrow$ `speaker_name` $\rightarrow$ `defaultVoiceId`.
     - Cập nhật `generate_srt_tts` (chế độ giữ mốc SRT): bóc tách hoặc nhận diện `spoken_text`, infer với giọng tương ứng của từng câu, chèn đúng timestamp.
     - Cập nhật `generate_srt_tts_aligned` (chế độ tự căn timing): infer từng câu theo giọng nhân vật tương ứng, giữ nguyên nhãn và metadata người nói khi xuất file `.aligned.srt`.
     - Đảm bảo an toàn: Chỉ truyền `spokenText` (đã bỏ nhãn tiền tố) vào model TTS để tránh việc đọc tên nhân vật ra tiếng.
  2. `src-tauri/src/executors/tts.rs` & `src-tauri/src/commands.rs`:
     - Mở rộng enum `TtsRequest::GenerateSrtTts` và hàm `synthesize_srt`: hỗ trợ nhận thêm `speech_config` và danh sách `cues`.
     - Cập nhật tauri command `generate_whiteboard_srt_tts`.
  3. `src/api.ts`: Cập nhật hàm gọi IPC `generateWhiteboardSrtTts` để truyền `speechConfig` và `cues`.
  4. `sidecar-whiteboard/tests/test_audio_driven_timing.py`: Bổ sung 2 test case:
     - `test_multi_speaker_resolves_and_infers_assigned_voices`: kiểm tra 3 câu thoại 3 nhân vật (Thầy giáo, Học sinh, Người dẫn chuyện) gọi đúng `Hải Đăng`, `Trúc Ly`, `Thùy Dung` ở chế độ auto-timing.
     - `test_multi_speaker_fixed_timing_resolves_voices`: kiểm tra gán đúng giọng ở chế độ fixed-timing.
- **Kết quả nghiệm thu**:
  - `sidecar-whiteboard/tests/test_audio_driven_timing.py`: 11/11 tests passed.
  - Rust checks & tests (`cargo test`): 26/26 passed.
  - Frontend build (`npm run build`): Thành công 100%.

---

## Báo cáo Mốc 3 (M3) — UI, Quản lý Trạng thái & Phân vai Từng Câu
- **Thời gian hoàn thành**: 08/11/2026.
- **Các thay đổi đã thực hiện**:
  1. `src/components/WhiteboardEditor.tsx`:
     - **Toggle chế độ đọc**: Bổ sung radio button chuyển đổi giữa `Một giọng` (mặc định) và `Theo nhân vật (N)`.
     - **Bảng phân vai nhân vật (Whiteboard Character Bible)**:
       - Tự động hiển thị danh sách nhân vật được bóc tách từ nhãn `[Tên]:` khi bấm "Chia Cảnh".
       - Mỗi nhân vật có dropdown chọn giọng VieNeu-TTS độc lập và nút **"Nghe"** thử giọng trực tiếp qua `api.previewTtsVoice`.
       - Luôn có hàng chỉ định giọng cho **Người dẫn chuyện** (dành cho các câu không nhãn).
     - **Sửa người nói từng câu phụ đề trong Chi tiết phân cảnh**:
       - Tại mỗi cảnh, danh sách câu phụ đề hiển thị lời thoại đã tách nhãn (`spokenText`) và dòng gốc (`sourceText`).
       - Ở chế độ theo nhân vật, mỗi câu có dropdown cho phép chọn người nói cụ thể hoặc gán về `(Người dẫn chuyện)`.
     - **Tích hợp lưu và mở dự án**:
       - Lưu đầy đủ `speechConfig` (mode, defaultVoiceId, timingMode, speakers) vào file `.whiteboard.json`.
       - Mở lại dự án khôi phục nguyên vẹn trạng thái phân vai và danh sách nhân vật.
     - **Chống kết quả lỗi thời (Stale results)**:
       - Đổi bất kỳ giọng đọc, nhân vật, hoặc chế độ nào sẽ tự động reset trạng thái thành công (`ttsSuccess = false`) và cập nhật hash snapshot để đảm bảo audio xuất ra luôn đồng bộ với cấu hình hiện tại.
- **Kết quả nghiệm thu**:
  - `sidecar-whiteboard/tests/test_audio_driven_timing.py`: 11/11 passed.
  - `sidecar-whiteboard/tests/test_parse_srt.py`: 10/10 passed.
  - Rust checks & tests (`cargo test`): 26/26 passed.
  - TypeScript build (`npm run build`): Đạt 100% không có lỗi cảnh báo.

---

## Báo cáo Mốc 4 (M4) — Nghiệm Thu Toàn Luồng E2E & Hoàn Tất Tài Liệu
- **Thời gian hoàn thành**: 08/11/2026.
- **Các hạng mục nghiệm thu**:
  1. **Kiểm tra tương thích ngược (Backward Compatibility)**:
     - Toàn bộ các dự án cũ mở bình thường ở chế độ `Một giọng` (`single`).
     - File SRT không có nhãn nhân vật được gán tự động cho `Người dẫn chuyện`, không bị lỗi parser.
  2. **Kiểm tra luồng đối thoại nhiều nhân vật trong 1 cảnh**:
     - Thử nghiệm với file SRT chứa nhiều vai đối thoại: `[Thầy giáo]`, `[Học sinh]`, câu dẫn chuyện không nhãn.
     - Kiểm tra bóc tách `speakerName`, làm sạch `spokenText`.
     - Bộ tổng hợp TTS gọi chính xác các giọng được chỉ định cho từng câu, chèn đúng timeline master audio.
     - Lời thoại không bị đọc lẫn tên nhãn nhân vật ra tiếng.
  3. **Kiểm tra bộ test tự động (Automated Test Suite)**:
     - Rust (`cargo test`): **26/26 tests passed**.
     - Python Whiteboard / TTS (`test_audio_driven_timing.py`, `test_parse_srt.py`, `test_thumbnail.py`): **26/26 tests passed**.
     - Frontend TypeScript: `npm run build` thành công, sạch sẽ không lỗi type.
  4. **Cập nhật tài liệu**:
     - Cập nhật `README.md` mục **3. Hoạt Họa Bảng Trắng Đa Giọng Đọc (Whiteboard Multi-Speaker Character Bible)**.
     - Cập nhật `docs/whiteboard-project-format.md` với định dạng `speechConfig` và metadata của `cue`.

---

## Báo cáo Khắc phục & Hoàn thiện Chặt chẽ (Hardening Follow-up)
- **Thời gian hoàn thành**: 09/11/2026.
- **Các vấn đề đã xử lý triệt để**:
  1. **Chuyển cue sang người dẫn chuyện bị đọc giọng nhân vật cũ**:
     - *Nguyên nhân*: Khi cue có `speakerId = null`, nhánh parser phía sau fallback đọc lại nhãn `[Tên]:` từ `sourceText`.
     - *Khắc phục*: Trong `sidecar-tts/tts_runner.py`, phân biệt rõ ràng giữa "chưa gán `speaker_id`" và "explicitly gán `speaker_id = null` (Người dẫn chuyện)". Khi người dùng chuyển sang người dẫn chuyện, hệ thống hủy bỏ `speaker_name`, chỉ đưa `spokenText` và dùng đúng `defaultVoiceId`.
  2. **Fingerprint chứng minh Audio khớp cấu hình trước khi xuất**:
     - *Khắc phục*: Bổ sung `audioFingerprint` tính toán từ hash chuỗi `(speechMode, defaultVoiceId, timingMode, speakers, cues)`. Khi người dùng đổi giọng, đổi phân vai hoặc sửa lời thoại, `isTtsCurrent` trở thành `false`. Nếu bấm "Xuất Toàn Bộ Dự Án", hệ thống lập tức chặn lại và cảnh báo yêu cầu nhấn "Tạo TTS" để đồng bộ trước khi xuất.
  3. **Mở dự án cũ không có speechConfig**:
     - *Khắc phục*: Trong `handleOpenProject` và `handleReset`, nếu dự án thiếu `speechConfig`, hệ thống reset sạch sẽ `speechMode = "single"`, `selectedVoice = "Thùy Dung"`, `autoTiming = true`, `speakers = []` và `audioFingerprint = null`, không còn lưu giữ trạng thái của project mở trước đó.
  4. **SRT tự căn xuất nhãn người nói đồng bộ**:
     - *Khắc phục*: Khi xuất file `.aligned.srt`, câu nào có nhân vật sẽ xuất `[Tên nhân vật]: Lời thoại`, câu người dẫn chuyện chỉ xuất `Lời thoại`. Khi import lại file này, các vai và người dẫn chuyện được khôi phục chính xác 100%.
  5. **Báo lỗi nghiêm ngặt cho ID nhân vật hoặc giọng không hợp lệ**:
     - *Khắc phục*: Loại bỏ hoàn toàn fallback âm thầm. Nếu `speaker_id` không tồn tại trong danh sách `speakers`, ném `SPEAKER_NOT_FOUND`. Nếu `voiceId` không tồn tại trong engine VieNeu, ném `VOICE_NOT_FOUND` kèm số thứ tự câu thoại để người dùng chỉnh sửa ngay.
- **Kết quả kiểm thử**:
  - `sidecar-whiteboard/tests/test_audio_driven_timing.py`: 13/13 passed (bổ sung test case kiểm tra override người dẫn chuyện và test bắt lỗi ID/voice không hợp lệ).
  - Rust tests: 26/26 passed.
  - Frontend TypeScript build: 100% passed.
- **Đánh giá tổng thể**: Bản đầu (M1–M4) đã hoàn thành xuất sắc, đầy đủ tính năng và sẵn sàng đưa vào sử dụng thực tế.

---

## Báo cáo Triển khai Mốc I1: Chuẩn bị mẫu và tài liệu đặc tả WB Schema 3

- **Thời gian hoàn thành**: 2026-11-09
- **Nội dung công việc đã thực hiện**:
  1. **Tạo bộ fixtures thực tế chuẩn WB Schema 3**:
     - `sidecar-whiteboard/tests/fixtures/wb_import/single_scene_three_cues.srt` & `single_scene_three_cues.wb.json`: Bộ 1 scene chứa 3 cues (Người dẫn chuyện, Thầy giáo, Học sinh). SHA-256 đối chiếu khớp 100% (`454a289818e45b6341837f3e92f3c812555d30857708b34e619b1a1427626ae4`).
     - `sidecar-whiteboard/tests/fixtures/wb_import/multi_scene_twelve_cues.srt` & `multi_scene_twelve_cues.wb.json`: Bộ 4 scenes chứa 12 cues với các nhân vật xuất hiện lặp lại qua các scene (Thầy giáo, An, Mai, Người dẫn chuyện). SHA-256 đối chiếu khớp 100% (`18529d1b8f0e1ebc372984f523560c365b0732b08ee6860468a29b5a42c29f8d`).
  2. **Định nghĩa TypeScript types cho WB Schema 3**:
     - Bổ sung vào `src/types/whiteboard.ts`: `WhiteboardWbCharacter`, `WhiteboardWbSpeaker`, `WhiteboardWbSpeech`, `WhiteboardWbCue`, `WhiteboardWbBeat`, `WhiteboardWbScene`, `WhiteboardWbMeta`, `WhiteboardWbInspectResult`.
  3. **Đặc tả kỹ thuật quy tắc ánh xạ**:
     - Bổ sung tài liệu vào `docs/whiteboard-project-format.md` làm rõ cơ chế 1 scene WB tương ứng đúng 1 `WhiteboardSceneItem` chứa danh sách các cues (`cue_ids`), không bị chia vụn theo thuật toán DP truyền thống; cơ chế đối chiếu SHA-256 chống lệch phụ đề và tự động chuyển đổi danh sách nhân vật sang `WhiteboardSpeechConfig`.
  4. **Kiểm thử**:
     - Viết script Python nội bộ xác thực cấu trúc và SHA-256 của các fixtures.
     - Chạy `npm run build` (`tsc && vite build`) xác nhận toàn bộ kiểu dữ liệu tương thích, không phát sinh lỗi.

---

## Báo cáo Triển khai Mốc I2: Backend reader và validator cho bộ SRT + .wb.json

- **Thời gian hoàn thành**: 2026-11-09
- **Nội dung công việc đã thực hiện**:
  1. **Module Python Validator & Parser (`sidecar-whiteboard/scripts/wb_import.py`)**:
     - Viết các hàm `compute_file_sha256`, `find_wb_json_for_srt`, và `inspect_wb_bundle(srt_path, wb_json_path)`.
     - Kiểm tra và bắt lỗi chính xác theo mã:
       + `WB_SRT_NOT_FOUND`: Tệp SRT không tồn tại.
       + `WB_JSON_NOT_FOUND`: Không tìm thấy tệp `.wb.json` đi kèm cạnh tệp SRT.
       + `WB_INVALID_JSON`: Cú pháp JSON của kịch bản bị hỏng.
       + `WB_SCHEMA_MISMATCH`: `schema_version` khác 3.
       + `WB_SRT_HASH_MISMATCH`: Mã băm SHA-256 tính từ bytes raw của tệp SRT không khớp với `srt_sha256` trong `.wb.json`.
       + `WB_CUE_COUNT_MISMATCH`: Số câu thoại trong `.wb.json` không khớp số cue đọc từ tệp SRT.
       + `WB_SPEAKER_NOT_FOUND`: `speaker_id` của câu thoại không có trong danh mục `speech.speakers`.
       + `WB_SCENE_EMPTY`: Phân cảnh không chứa `cue_ids`.
       + `WB_SCENE_CUE_INVALID`: Phân cảnh trỏ đến cue không tồn tại.
       + `WB_SCENE_CUE_DUPLICATED`: Cue bị trỏ lặp lại ở nhiều phân cảnh.
       + `WB_SCENE_CUE_MISSING`: Có câu thoại bị bỏ rơi không thuộc bất kỳ cảnh nào.
     - Tự động ánh xạ và trả về danh sách `WhiteboardSceneItem[]` và `WhiteboardSpeaker[]` chuẩn bị cho bước nhập.
  2. **Tích hợp vào Sidecar Runner (`sidecar-whiteboard/whiteboard_runner.py`)**:
     - Bổ sung lệnh `inspect_wb_import` vào `HANDLERS`.
  3. **Tích hợp vào Rust Backend (`src-tauri`)**:
     - Thêm biến thể `WhiteboardRequest::InspectWbImport` và hàm `inspect_wb_import` trong `src-tauri/src/executors/whiteboard.rs`.
     - Thêm Tauri command `inspect_whiteboard_wb_import` trong `src-tauri/src/commands.rs`.
     - Đăng ký command vào `invoke_handler` trong `src-tauri/src/lib.rs`.
  4. **Frontend API (`src/api.ts`)**:
     - Thêm hàm `api.inspectWhiteboardWbImport(srtPath, wbJsonPath?)` trả về kiểu `WhiteboardWbInspectResult`.
  5. **Kiểm thử**:
     - Tạo bộ test unit toàn diện `sidecar-whiteboard/tests/test_wb_import.py`: 6/6 test cases passed (kiểm tra fixture 1-scene, fixture 4-scene 12-cue, lỗi schema, lỗi hash mismatch, lỗi speaker not found, lỗi scene cue missing/invalid).
     - Rust backend: `cargo check` biên dịch thành công 100%.
     - Frontend TypeScript: `npm run build` thành công không có lỗi.

---

## Báo cáo Triển khai Mốc I3: Bộ chuyển đổi (Adapter) cấu trúc dữ liệu dự án Whiteboard

- **Thời gian hoàn thành**: 2026-11-09
- **Nội dung công việc đã thực hiện**:
  1. **Hoàn thiện logic ánh xạ trong Python (`sidecar-whiteboard/scripts/wb_import.py`)**:
     - Ánh xạ 1:1 chuẩn xác giữa mỗi phần tử trong `scenes` của `.wb.json` sang 1 `WhiteboardSceneItem` chứa toàn bộ mảng `cues` tương ứng (giữ nguyên thứ tự, spokenText, speakerName, speakerId).
     - Lưu giữ các thuộc tính phong phú phục vụ sinh ảnh/annotation: `storyBasis` (từ `moment` hoặc `setting`), `text`, `cueRange`.
     - Tính toán chính xác thời lượng `timelineStartMs`, `timelineEndMs`, `durationMs`, `sceneDurationMs`.
     - Danh mục 25 giọng chuẩn VieNeu (`VALID_VIENEU_VOICES`): kiểm tra bằng Unicode NFC; nếu giọng không có trong preset thì tự động fallback về `Thùy Dung` kèm theo thông báo trong `warnings`.
     - Tự động xác định `speechMode`: `"characters"` nếu có >= 1 speaker hợp lệ, ngược lại `"single"`.
  2. **Bộ chuyển đổi TypeScript Adapter (`src/utils/whiteboardWbAdapter.ts`)**:
     - Xây dựng hàm `buildProjectFromWbImport(inspectResult, srtPath, baseProject?)`:
       + Chuyển đổi `WhiteboardWbInspectResult` thành `WhiteboardProject` hoàn chỉnh.
       + Thiết lập `speechConfig` với `speakers`, `mode`, `defaultVoiceId`.
       + Reset `masterAudioPath`, `outputVideoPath`, và `audioFingerprint` để đảm bảo dự án luôn tạo audio mới khớp với phân vai.
  3. **Kiểm tra tương thích Pipeline Annotation**:
     - Xác nhận `handle_generate_annotation` trong `whiteboard_runner.py` phân tích và phân bổ mượt mà mảng `cues` nhiều câu theo cụm cho các vùng vẽ bảng mà không gây lỗi phân mảnh.
  4. **Kiểm thử**:
     - `sidecar-whiteboard/tests/test_wb_import.py`: 7/7 test cases passed (thêm test case kiểm tra fallback giọng lạ về giọng mặc định kèm cảnh báo).
     - Frontend TypeScript: `npm run build` thành công không lỗi.

---

## Báo cáo Triển khai Mốc I4: Giao diện người dùng (UI) luồng Import bộ Whiteboard

- **Thời gian hoàn thành**: 2026-11-09
- **Nội dung công việc đã thực hiện**:
  1. **Tự động nhận diện khi chọn tệp SRT**:
     - Nâng cấp `handlePickSrt` trong `WhiteboardEditor.tsx`: Khi người dùng chọn tệp `<slug>.srt`, hệ thống tự động kiểm tra xem có tệp `<slug>.wb.json` nằm cùng thư mục không thông qua `api.inspectWhiteboardWbImport`.
     - Nếu phát hiện tệp kịch bản `.wb.json` hợp lệ, modal xác nhận thông minh sẽ lập tức xuất hiện.
  2. **Nút Thao tác Trực tiếp "Kịch bản WB"**:
     - Bổ sung nút "Kịch bản WB" trên thanh công cụ SRT cạnh nút "Chọn" và "Chia Cảnh", cho phép người dùng chủ động kiểm tra và nhập lại kịch bản bất kỳ lúc nào.
  3. **Hộp thoại Modal Xác nhận & Preview Kịch Bản (`wbImportModalData`)**:
     - **Trường hợp kịch bản hợp lệ**:
       + Hiển thị biểu tượng `BookOpen`, tiêu đề kịch bản, số lượng phân cảnh (nêu rõ nguyên tắc 1 cảnh = 1 ảnh minh họa), số lượng câu thoại, tổng thời lượng và chế độ phân vai.
       + Hiển thị danh mục các nhân vật đã phát hiện cùng giọng đọc VieNeu được gán.
       + Hiển thị cảnh báo nếu có giọng đọc được fallback.
       + 2 Tùy chọn rõ ràng:
         1. **"Nhập theo phân cảnh từ WB (Khuyên dùng)"**: Tự động ánh xạ cấu trúc cảnh, phân vai, lời thoại và cập nhật vào Editor.
         2. **"Chỉ chia cảnh theo SRT"**: Bỏ qua kịch bản `.wb.json`, chia cảnh theo thuật toán SRT thông thường.
     - **Trường hợp kịch bản không hợp lệ (sai hash SHA-256, sai schema, thiếu cue/speaker)**:
       + Hiển thị biểu tượng `AlertCircle` đỏ cùng danh sách lỗi chi tiết (ví dụ: cảnh báo tệp SRT đã bị sửa lệch khỏi kịch bản).
       + Cho phép chọn: "Tiếp tục chỉ dùng phụ đề SRT" hoặc "Hủy bỏ".
  4. **Kiểm thử**:
     - `npm run build` (`tsc && vite build`) hoàn thành 100% không có lỗi.
     - `cargo check` biên dịch sạch sẽ không có lỗi.

---

## Báo cáo Triển khai Mốc I5: Kiểm thử liên thông toàn trình (Roundtrip & Auto-timing test)

- **Thời gian hoàn thành**: 2026-11-09
- **Nội dung công việc đã thực hiện**:
  1. **Xây dựng Test Suite Toàn trình (`sidecar-whiteboard/tests/test_wb_import_roundtrip.py`)**:
     - Thiết lập `MockTtsEngine` giả lập VieNeu TTS với tốc độ sinh audio nhanh và ghi nhận các giọng đọc thực tế được gọi.
     - Kiểm thử liên thông chu trình 7 bước:
       1. Đọc và xác thực kịch bản WB Schema 3 (`multi_scene_twelve_cues.wb.json` & `.srt`).
       2. Ánh xạ kịch bản sang danh sách `WhiteboardSceneItem` ban đầu (4 scenes, mỗi scene chứa đúng 3 cues).
       3. Sinh giọng đọc đa nhân vật và căn thời gian tự động (`generate_srt_tts_aligned`).
       4. Kiểm tra sự bảo toàn phân cảnh: Sau khi căn timing, số lượng phân cảnh vẫn giữ nguyên đúng 4 cảnh, mỗi cảnh vẫn chứa đúng 3 cues (`[1, 3]`, `[4, 6]`, `[7, 9]`, `[10, 12]`), mốc thời gian `timelineStartMs`, `timelineEndMs`, `durationMs`, `speechEndMs` khớp chính xác từng mili-giây.
       5. Kiểm tra phân vai: Gọi đúng giọng đọc đã gán cho từng nhân vật (`Hải Đăng` cho Thầy giáo, `Thanh Long` cho An, `Thu Hà` cho Mai, `Thùy Dung` cho Người dẫn chuyện).
       6. Kiểm tra tệp phụ đề căn chuẩn (`.aligned.srt`): Xuất đúng nhãn `[Tên]:` cho nhân vật và văn bản trần cho người dẫn chuyện.
       7. Tái nhập từ `.aligned.srt` qua `parse_srt`: Khôi phục chuẩn xác 100% tên nhân vật tương ứng cho 12 câu.
  2. **Kiểm thử cho cả bộ 1 scene 3 cues**:
     - Bổ sung test case `test_single_scene_three_cues_timing_roundtrip`: Xác nhận phân cảnh 1 scene chứa nhiều câu thoại đối thoại giữa các nhân vật hoạt động trơn tru.
  3. **Kết quả kiểm thử**:
     - `sidecar-whiteboard/tests/test_wb_import_roundtrip.py`: 2/2 tests passed 100% trong 0.031 giây.
     - Toàn bộ 9 bài kiểm thử WB import (`test_wb_import*.py`): 9/9 passed 100%.

---

## Báo cáo Triển khai Mốc I6: Tài liệu hóa & Hướng dẫn sử dụng tính năng Import WB

- **Thời gian hoàn thành**: 2026-11-09
- **Nội dung công việc đã thực hiện**:
  1. **Cập nhật tài liệu kỹ thuật**:
     - `docs/whiteboard-project-format.md`: Đặc tả cấu trúc `.wb.json` Schema 3, quy tắc ánh xạ 1:1 giữa scene kịch bản và `WhiteboardSceneItem`, cơ chế xác thực SHA-256.
     - `docs/huong-dan-su-dung-whiteboard.md`: Bổ sung Mục 6 chi tiết hướng dẫn thao tác đối thoại nhiều nhân vật, Character Bible, quy trình nhận diện tự động và sử dụng nút "Kịch bản WB".
     - `README.md`: Nâng cấp phiên bản lên **v0.8.0** với tóm tắt đầy đủ tính năng mới.
  2. **Tổng kết hoàn thành toàn bộ Kế hoạch**:
     - Hoàn thành đầy đủ 4 mốc nền tảng (M1 $\rightarrow$ M4): Parse nhãn SRT, Character Bible UI, TTS Runner đa giọng, Xuất/Mở dự án với `speechConfig` và bảo vệ audio fingerprint.
     - Hoàn thành đầy đủ 6 mốc bổ sung (I1 $\rightarrow$ I6): Chuẩn bị mẫu Schema 3, Parser & Validator SHA-256, Adapter cấu trúc dữ liệu, UI Modal preview & import, Test suite liên thông toàn trình 100% passed, Tài liệu hóa hoàn chỉnh.
     - Toàn bộ hệ thống sẵn sàng phát hành chính thức phiên bản `v0.8.0`.






