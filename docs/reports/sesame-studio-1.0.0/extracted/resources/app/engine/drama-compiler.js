/**
 * DRAMA COMPILER — hợp đồng cảnh có cấu trúc + kiểm tra theo bộ quy tắc làm phim AI + biên dịch prompt.
 *
 * Nguyên tắc: ý đồ đạo diễn là DỮ LIỆU (nhân vật, ảnh tham chiếu, hành động quay được, beat theo giây,
 * cảm xúc từng người, camera, lời bình), prompt chỉ là bản dịch từ dữ liệu đó. Không ghép chữ từ lời bình.
 *
 * Module thuần (không DOM, không fs): dùng ở giao diện (window.DramaCompiler) và ở tiến trình chính / test (require).
 * Bản này dùng chung giữa các dự án (có test so sánh hash).
 *
 * Ghi chú trung thực: các kiểm tra theo TỪ KHÓA (cảm xúc trong ngoại hình, miêu tả tâm lý) chỉ bắt được một phần.
 * Các kiểm tra theo CẤU TRÚC (số người, phía màn hình, bậc cường độ, hook, đổi trạng thái) mới chắc chắn.
 */
(function (root) {
  'use strict';

  const SECONDS = [5, 6, 8, 10, 15, 30];     // Hỗ trợ 5/6/8/10/15/30s theo chuẩn Muse & V5.1 Timing Engine
  const MAX_IN_FRAME = 2;                    // khung 9:16 tối đa 2 người
  const MAX_BEATS = 2;
  const STATE_CHANGES = ['info', 'power', 'relation', 'emotion', 'risk'];
  const SIZES = { wide: 'toàn cảnh', medium: 'trung cảnh', close: 'cận cảnh' };
  const MOVES = {
    static: 'máy quay đứng yên',
    'push-in': 'máy quay đẩy vào chậm (tăng căng thẳng)',
    'pull-back': 'máy quay kéo lùi chậm (mở không gian)',
    pan: 'máy quay lia ngang chậm',
    tracking: 'máy quay đi theo nhân vật'
  };
  const AUDIO_MODES = ['narration', 'caption', 'dialogue', 'mode_a', 'mode_b'];
  const WORDS_PER_SEC = 4.3;                 // tốc độ đọc tiếng Việt tự nhiên (từ/giây) để ước lượng

  // ---------------------------------------------------------------------------------------------------------------
  // VIETNAMESE DRAMA MUSE V5.1 — 5 TRỤ CỘT KỸ THUẬT:
  // 1. IVS (Independent Visual Storytelling): Mỗi clip là cảnh tái hiện kịch tính độc lập (tay, đạo cụ, bóng lưng,
  //    giọt nước mắt, silhouette, đại cảnh) — triệt tiêu 100% lỗi trôi mặt / biến dạng mặt qua các cảnh.
  // 2. Speaker Firewall (Bức tường lửa giọng nói): Phân định rạch ròi NARRATOR_001 (off-screen) và VOICE_001..N
  //    (thoại nhân vật), khung giờ độc quyền không chồng chéo, cấm nhép môi (no lip-sync).
  // 3. Audio Mode B (Chế độ âm thanh tách rời): Muse chỉ tạo hình ảnh điện ảnh sạch (không tiếng nói), xuất timeline
  //    hậu kỳ riêng cho VieNeu-TTS / Edge-TTS khớp thời gian (timeSync).
  // 4. Chuẩn hóa Prompt Muse V5.1: Cấm thông số kỹ thuật (9:16, fps, bitrate) trong prompt; luôn gắn câu phủ định
  //    chuẩn V5.1: "No visible speaking, no lip-sync, no voice swap, no morphing, no extra limbs, no subtitles, no watermarks."
  // 5. 9 Thể loại kịch bản ăn khách (DRAMA_GENRES): Gia đình, Tình yêu/phản bội, Tổng tài, Thế giới ngầm, Báo thù,
  //    Bí mật thân phận, Mẹ chồng nàng dâu, Nông thôn, Tự chọn.
  // ---------------------------------------------------------------------------------------------------------------
  const NEGATIVE_V51 = 'No visible speaking, no lip-sync, no voice swap, no morphing, no teleportation, no extra limbs, no subtitles, no watermarks.';
  const NEGATIVE_V51_FULL = 'No visible speaking, no lip-sync, no voice swap, no actor reading narration, no narrator speaking character lines, no accent drift, no extra words, no overlapping voices, no morphing, no teleportation, no extra limbs, no floating objects, no warped geometry, no unrelated actions, no random cuts, no subtitles or watermarks.';
  const SPEAKER_FIREWALL_RULE = 'Narrator NARRATOR_001 is strictly off-screen and never speaks character dialogue; characters VOICE_001..N never read narration; no overlapping voices; no visible speaking or lip-sync on screen.';
  const TECH_FORBIDDEN_RE = /\b(tỉ lệ\s*9:16|dọc\s*9:16|khung\s*9:16|9:16|16:9|1:1|4:3|\d+\s*fps|bitrate\s*\S*|h\.?264|h\.?265|hevc|1080p|720p|4k|8k)\b/gi;

  const IVS_SHOT_TYPES = [
    { id: 'hands_props', name: 'Cận cảnh đôi bàn tay & đạo cụ', desc: 'Cận cảnh đôi bàn tay tương tác với đạo cụ then chốt (tờ giấy, chiếc nhẫn, phong bì, tách trà), không lộ mặt' },
    { id: 'tear_detail', name: 'Chi tiết cảm xúc tinh tế', desc: 'Cận cảnh giọt nước mắt rơi, bàn tay siết chặt vạt áo hoặc bước chân khựng lại trên sàn' },
    { id: 'silhouette_rear', name: 'Bóng lưng / góc nghiêng ngược sáng', desc: 'Góc quay từ phía sau lưng hoặc bóng silhouette ngược sáng bên cửa sổ, giữ trọn cảm xúc không cần lộ khẩu hình' },
    { id: 'evidence_prop', name: 'Vật chứng / kỷ vật bí ẩn', desc: 'Cận cảnh đạo cụ mang tính bước ngoặt đặt trên bàn dưới ánh sáng tương phản mạnh' },
    { id: 'environment_empty', name: 'Đại cảnh không gian giàu cảm xúc', desc: 'Toàn cảnh không gian kiến trúc/bối cảnh nhuốm màu tâm trạng, bóng người rất nhỏ hoặc không người' },
    { id: 'symbolic_object', name: 'Hình ảnh ẩn dụ kịch tính', desc: 'Chi tiết biểu tượng (ngọn nến tắt, ly nước chao nghiêng, cánh cửa khép dần) đánh dấu cao trào' }
  ];

  const DRAMA_GENRES = [
    {
      id: 'family',
      name: 'Gia đình',
      label: '🏠 Gia đình (Tình thân & Bi kịch)',
      re: /(gia đình|cha mẹ|bố mẹ|anh em|con cái|chia gia tài|hiếu thảo|từ mẫu|mái nhà)/i,
      hookHint: 'Bữa cơm gia đình căng thẳng hoặc tờ di chúc/giấy viện phí đặt mạnh xuống bàn gỗ.',
      styleHint: 'Màu phim điện ảnh ấm trầm pha tương phản bóng tối, ánh đèn vàng phòng khách gia đình Việt.',
      ivsFocus: 'Bàn tay già nua run rẩy cầm chén cơm, bóng lưng người cha ngoài hiên mưa, chiếc khung ảnh gia đình úp xuống.',
      sampleStory: 'Ngày giỗ cha, người anh cả đặt tờ giấy bán nhà từ đường lên bàn gỗ. Người em út lặng lẽ đặt chiếc hộp gỗ kỷ vật của cha bên cạnh, ánh đèn vàng hắt bóng hai người ở hai đầu bàn.'
    },
    {
      id: 'love_betrayal',
      name: 'Tình yêu / Phản bội',
      label: '💔 Tình yêu / Phản bội',
      re: /(phản bội|ngoại tình|chia tay|người yêu cũ|nhẫn cưới|vợ chồng|ly hôn|nhân tình)/i,
      hookHint: 'Chiếc nhẫn cưới được tháo ra đặt lên mặt bàn kính dưới ánh đèn đêm lạnh lẽo.',
      styleHint: 'Màu phim điện ảnh lạnh sắc nét (teal & amber), bóng đổ sâu, không khí đêm đô thị mưa phùn.',
      ivsFocus: 'Cận cảnh ngón tay tháo nhẫn cưới, giọt nước mắt rơi xuống tờ đơn, bóng lưng quay đi dưới ánh đèn đường ướt mưa.',
      sampleStory: 'Dưới ánh đèn vàng nhạt trong căn hộ, Minh lặng lẽ tháo chiếc nhẫn bạc đặt lên tập ảnh chụp lén trên bàn kính. Lan bước vào cửa, khựng lại khi nhìn thấy chiếc nhẫn nằm lẻ loi.'
    },
    {
      id: 'ceo',
      name: 'Tổng tài',
      label: '🏙️ Tổng tài (Hào môn & Thương trường)',
      re: /(tổng tài|chủ tịch|tập đoàn|hợp đồng|thư ký|hào môn|cổ phần|biệt thự)/i,
      hookHint: 'Cây bút máy đắt tiền dừng lại trên bản hợp đồng bạc tỷ tại phòng họp kính tầng cao.',
      styleHint: 'Màu phim điện ảnh sang trọng, độ tương phản cao, ánh sáng lạnh từ cửa kính sát trần nhìn ra thành phố.',
      ivsFocus: 'Đôi tay đeo đồng hồ cơ ký hợp đồng, bóng lưng vest đen trước vách kính toàn cảnh thành phố, chiếc thẻ đen đặt trên bàn đá.',
      sampleStory: 'Trên tầng cao nhất của tòa tháp kính, vị chủ tịch trẻ khép tập hồ sơ thâu tóm lại. Người trợ lý cúi đầu đặt chiếc phong bì niêm phong sáp đỏ lên mặt bàn đá cẩm thạch.'
    },
    {
      id: 'underworld',
      name: 'Thế giới ngầm',
      label: '🕶️ Thế giới ngầm (Giang hồ & Thanh trừng)',
      re: /(thế giới ngầm|ông trùm|giang hồ|đàn em|bến cảng|kho hàng|thanh trừng|bang hội)/i,
      hookHint: 'Ánh đèn pha ô tô quét qua kho hàng tối ngập sương đêm, một chiếc bật lửa kim loại bật sáng.',
      styleHint: 'Màu phim noir tương phản gắt, khói sương, ánh đèn neon phản chiếu trên mặt đường ướt.',
      ivsFocus: 'Bàn tay bật nắp chiếc bật lửa bạc, hàng bóng đen đứng dưới mưa bên bến cảng, chiếc gạt tàn đầy khói.',
      sampleStory: 'Giữa nhà kho cũ ở bến cảng lúc nửa đêm, người đàn ông áo măng tô đen đặt đồng xu cổ lên mặt thùng gỗ. Phía đối diện, gã cầm đầu lùi lại nửa bước khi nhận ra tín vật.'
    },
    {
      id: 'revenge',
      name: 'Báo thù',
      label: '🔥 Báo thù (Lật ngược thế cờ)',
      re: /(báo thù|trả thù|nợ máu|phản kích|lật cờ|quả báo|trở về|trọng sinh)/i,
      hookHint: 'Từng món bằng chứng năm xưa được xếp thẳng hàng trên bàn dưới ánh đèn chiếu thẳng.',
      styleHint: 'Màu phim điện ảnh sắc lạnh, ánh sáng chiaroscuro cắt khối mạnh, nhịp điệu dồn dập.',
      ivsFocus: 'Bàn tay gạch chéo bức ảnh cũ, bước chân giày cao gót dứt khoát trên hành lang đá, ngọn lửa bén vào góc tờ giấy.',
      sampleStory: 'Sau năm năm biệt tích, cô trở lại buổi tiệc đấu giá trong bộ váy đỏ thẫm, đặt chiếc đồng hồ quả quýt vỡ mặt kính vào khay nhung ngay trước mặt kẻ từng hãm hại gia đình mình.'
    },
    {
      id: 'hidden_identity',
      name: 'Bí mật thân phận',
      label: '🎭 Bí mật thân phận (Ẩn danh & Lộ diện)',
      re: /(thân phận|ẩn danh|giả nghèo|lộ diện|thừa kế|bí mật|danh tính|chủ nhân thật)/i,
      hookHint: 'Người bảo vệ mặc áo cũ lặng lẽ mở khóa chiếc két sắt sinh trắc học mà không ai mở được.',
      styleHint: 'Màu phim điện ảnh chân thực chuyển dần sang ánh sáng uy nghi khi thân phận hé lộ.',
      ivsFocus: 'Đôi bàn tay chai sần đeo chiếc nhẫn gia tộc, chiếc huy hiệu vàng giấu trong túi áo lao công, đoàn xe đen dừng trước cổng.',
      sampleStory: 'Ai cũng tưởng ông lão quét sân chỉ là người làm thuê nghèo khổ, cho đến khi đoàn xe sang dừng trước sảnh và vị tổng giám đốc cúi gập người trao lại chiếc ấn gỗ cho ông.'
    },
    {
      id: 'mother_in_law',
      name: 'Mẹ chồng nàng dâu',
      label: '🍵 Mẹ chồng nàng dâu (Sóng gió gia phong)',
      re: /(mẹ chồng|nàng dâu|con dâu|nhà chồng|gia giáo|bà thông gia|làm dâu)/i,
      hookHint: 'Tách trà nóng bị đặt mạnh xuống bàn gỗ làm nước trà bắn lên tà áo dài.',
      styleHint: 'Màu phim điện ảnh nội thất truyền thống pha hiện đại, ánh sáng tự nhiên qua khung cửa chớp.',
      ivsFocus: 'Đôi tay con dâu bưng khay trà, ánh mắt sắc lạnh nhìn từ cầu thang gỗ, chiếc vali đặt sẵn bên hiên nhà.',
      sampleStory: 'Sáng đầu tiên về nhà chồng, nàng dâu trẻ bưng khay trà sen đứng trước bàn phòng khách. Bà mẹ chồng ngồi ghế chính giữa, chậm rãi đẩy chiếc phong bì đỏ trả lại phía mép bàn.'
    },
    {
      id: 'rural',
      name: 'Nông thôn',
      label: '🌾 Nông thôn (Làng quê & Đổi đời)',
      re: /(nông thôn|làng quê|cánh đồng|bến nước|con đê|nhà tranh|quê nghèo|lên tỉnh)/i,
      hookHint: 'Chiếc xe đạp cũ dựng bên gốc đa đầu làng giữa buổi chiều nắng quái.',
      styleHint: 'Màu phim điện ảnh mộc mạc, ánh nắng chiều vàng rực trên cánh đồng và khói bếp quê.',
      ivsFocus: 'Đôi bàn tay lấm bùn cầm giấy báo trúng tuyển, bóng lưng mẹ đứng trông theo đầu ngõ tre, ngọn đèn dầu leo lét.',
      sampleStory: 'Chiều cuối thu bên hiên nhà ngói cũ, người mẹ quê mở chiếc khăn tay vải nâu lấy ra những đồng tiền lẻ đã vuốt phẳng, đặt vào tay con trai trước giờ lên thành phố.'
    },
    {
      id: 'ancient_palace',
      name: 'Cổ trang / Cung đấu',
      label: '🏯 Cổ trang / Cung đấu (Vương triều & Âm mưu)',
      re: /(cổ trang|cung đấu|hoàng hậu|phi tần|hoàng thượng|vương gia|tiểu thư|cổ trấn|trâm ngọc|cung đình)/i,
      hookHint: 'Chiếc trâm ngọc phượng hoàng đặt cạnh chén trà sứ xanh còn bốc khói dưới ánh nến cung đình.',
      styleHint: 'Màu phim điện ảnh cổ điển trầm mặc, ánh đèn lồng đỏ và ánh nến hắt qua rèm lụa tạo chiều sâu.',
      ivsFocus: 'Đôi tay thon dài trong tay áo lụa nâng chén trà sứ, bóng lưng dưới mái hiên cổ kính, chiếc lệnh bài khắc rồng.',
      sampleStory: 'Dưới ánh đèn lồng đỏ trong thư phòng cổ kính, vị tiểu thư chậm rãi đặt chiếc lệnh bài ngọc bích lên mặt bàn gỗ đàn hương trước ánh mắt sững sờ của vị quản gia.'
    },
    {
      id: 'custom',
      name: 'Tự chọn',
      label: '✨ Tự chọn (Kịch bản tự do)',
      re: /./,
      hookHint: 'Tình huống xung đột hoặc chi tiết gây tò mò xuất hiện ngay giây đầu tiên của cảnh.',
      styleHint: 'Màu phim điện ảnh chân thực, ánh sáng có chiều sâu, giữ đồng nhất tông màu toàn series.',
      ivsFocus: 'Tập trung vào hành động hình thể, đạo cụ then chốt, góc quay bóng lưng/nghiêng và không gian giàu cảm xúc.',
      sampleStory: 'Trong căn phòng làm việc yên tĩnh lúc chiều muộn, hai người đối diện qua chiếc bàn gỗ dài khi một bức thư chưa bóc tem được đặt chính giữa.'
    }
  ];

  function genreFor(idOrText) {
    const key = s(idOrText).toLowerCase();
    const byId = DRAMA_GENRES.find(g => g.id === key || g.name.toLowerCase() === key);
    if (byId) return byId;
    if (key) {
      const byRe = DRAMA_GENRES.slice(0, -1).find(g => g.re.test(idOrText));
      if (byRe) return byRe;
    }
    return DRAMA_GENRES[DRAMA_GENRES.length - 1];
  }

  function sanitizeMusePrompt(text) {
    return s(text)
      .replace(TECH_FORBIDDEN_RE, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.;:])/g, '$1')
      .trim();
  }

  // Kiểm tra theo TỪ KHÓA (chỉ bắt một phần, nên mức "lỗi" chỉ dùng cho trường hợp chắc chắn)
  const EMOTION_IN_LOOK = /(buồn|vui|giận|tức giận|lạnh lùng|mệt mỏi|trầm lặng|hạnh phúc|đau khổ|tuyệt vọng|cười|khóc|ngạo mạn|kiêu ngạo|dịu dàng|sợ hãi|lo lắng|e thẹn|nghiêm nghị|căng thẳng|thờ ơ)/i;
  const PSYCHOLOGY = /(nghĩ (rằng|về|đến|tới)|cảm thấy|nhớ lại|hồi tưởng|tự hỏi|biết rằng|nhận ra rằng|trong lòng|thầm nghĩ)/i;
  const SNAKE_LABEL = /\b[A-Z]{2,}_[A-Z0-9_]+\b|\[[A-Z0-9_ ]{3,}\]/;
  const OPPOSITE = { left: 'right', right: 'left' };

  const s = v => (v == null ? '' : String(v)).trim();
  const tidy = v => s(v).replace(/[.\s]+$/, '');   // bỏ dấu chấm cuối để ghép câu không bị '..'
  const words = t => s(t).split(/\s+/).filter(Boolean).length;
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

  /** Kiểm tra spec. Trả { errors: [], warnings: [], stats }. Có lỗi thì KHÔNG được tốn lượt gen. */
  function validate(spec) {
    const errors = [], warnings = [];
    const E = (where, msg) => errors.push({ where, msg });
    const W = (where, msg) => warnings.push({ where, msg });

    if (!isObj(spec)) { E('spec', 'Spec phải là một đối tượng JSON.'); return { errors, warnings, stats: {} }; }
    if (!AUDIO_MODES.includes(spec.audio)) E('audio', `Phải chọn một kiểu âm thanh cho cả series: ${AUDIO_MODES.join(' | ')}.`);
    if (spec.audio === 'dialogue') {
      // Chế độ phim có thoại: hỗ trợ đa giọng (multivoice) và câu thoại từng nhân vật
      const hasDlg = spec.shots && spec.shots.some(sh => (Array.isArray(sh.dialogue) && sh.dialogue.length) || s(sh.narration));
      if (!hasDlg) W('audio', 'Chế độ thoại: nên nhập câu thoại (dialogue) cho từng cảnh để lồng tiếng phân vai.');
    }
    if (!s(spec.style)) W('style', 'Thiếu câu khóa màu phim/thời tiết dùng chung cho mọi clip (quy tắc 6).');
    if (!spec.ivs && (!Array.isArray(spec.characters) || !spec.characters.length)) E('characters', 'Thiếu bảng nhân vật (mỗi người: id, name, look).');
    if (!Array.isArray(spec.shots) || !spec.shots.length) { E('shots', 'Thiếu danh sách shot.'); return { errors, warnings, stats: {} }; }

    const chars = {};
    (spec.characters || []).forEach((c, i) => {
      const w = `characters[${i}]`;
      if (!isObj(c)) return E(w, 'Nhân vật phải là đối tượng.');
      if (!s(c.id)) E(w, 'Thiếu id.'); else if (chars[c.id]) E(w, `Trùng id "${c.id}".`); else chars[c.id] = c;
      if (!s(c.name)) E(w, 'Thiếu name.');
      if (!s(c.look)) E(w, 'Thiếu look (một câu ngoại hình: tuổi, mặt, tóc, trang phục, phụ kiện).');
      // Chuyển từ LỖI sang CẢNH BÁO: người dùng thường viết "nam chính lạnh lùng", "cô gái dịu dàng". Không chặn gen, chỉ lưu ý.
      if (EMOTION_IN_LOOK.test(s(c.look))) W(w, `look chứa từ cảm xúc ("${(EMOTION_IN_LOOK.exec(s(c.look)) || [])[0]}"). Lưu ý: câu ngoại hình dùng chung cho mọi cảnh; nếu muốn nhân vật linh hoạt biểu cảm thì nên chuyển từ này sang phần diễn biến từng cảnh.`);
      if (SNAKE_LABEL.test(s(c.look))) E(w, 'look chứa nhãn VIẾT_HOA_gạch_dưới; model sẽ vẽ nó thành chữ lên hình (quy tắc 1).');
      if (!(Number(c.height_cm) >= 100 && Number(c.height_cm) <= 220)) W(w, 'Thiếu height_cm (số). Cần khi 2 người chung khung để tỉ lệ chiều cao không bị phóng đại.');
    });

    // BIBLE: bối cảnh / trang phục / đạo cụ được KHÓA một lần, mọi shot chỉ tham chiếu bằng id (chống trôi giữa các cảnh).
    const bible = isObj(spec.bible) ? spec.bible : {};
    const locs = {}, wards = {}, propsById = {};
    const regBible = (arr, map, kind, fields) => {
      if (arr != null && !Array.isArray(arr)) { E(`bible.${kind}`, 'Phải là mảng.'); return; }
      (arr || []).forEach((x, i) => {
        const bw = `bible.${kind}[${i}]`;
        if (!isObj(x)) return E(bw, 'Phải là đối tượng.');
        if (!s(x.id)) E(bw, 'Thiếu id.'); else if (map[x.id]) E(bw, `Trùng id "${x.id}".`); else map[x.id] = x;
        fields.forEach(f => { if (!s(x[f])) E(bw, `Thiếu ${f}.`); else if (SNAKE_LABEL.test(s(x[f]))) E(bw, `${f} chứa nhãn VIẾT_HOA_gạch_dưới (model sẽ vẽ thành chữ).`); });
        if (kind === 'wardrobe' && s(x.char) && !chars[x.char]) E(bw, `char không tồn tại: "${x.char}".`);
        if (kind === 'wardrobe' && EMOTION_IN_LOOK.test(s(x.desc))) W(bw, 'desc trang phục chứa từ cảm xúc; trang phục chỉ nên mô tả quần áo, màu, chất liệu, phụ kiện.');
        if (!s(x.ref)) W(bw, 'Chưa có ref (id ảnh trong Tư liệu). Chỉ có chữ thì model dễ vẽ lệch; nên có ảnh khóa.');
      });
    };
    regBible(bible.locations, locs, 'locations', ['name', 'look']);
    regBible(bible.wardrobe, wards, 'wardrobe', ['char', 'desc']);
    regBible(bible.props, propsById, 'props', ['name', 'desc']);
    const settingKey = sh => s(sh && sh.location) || s(sh && sh.setting);
    const prevOutfit = {};
    let prevProps = [];

    const prev = { setting: null, sides: {}, size: null, level: {} };
    let total = 0;
    spec.shots.forEach((sh, i) => {
      const w = `shots[${i}] (shot ${sh && sh.id != null ? sh.id : i + 1})`;
      if (!isObj(sh)) return E(w, 'Shot phải là đối tượng.');
      const secs = Number(sh.seconds);
      if (!SECONDS.includes(secs)) E(w, `seconds phải là một trong ${SECONDS.join('/')} (Muse chỉ có các độ dài này).`); else total += secs;
      if (!s(sh.purpose)) W(w, 'Nên có purpose: người xem hiểu/cảm nhận gì chỉ bằng hình (quy tắc 23).');
      if (!s(sh.setting) && !s(sh.location)) E(w, 'Thiếu setting hoặc location (bối cảnh của clip).');
      if (!STATE_CHANGES.includes(sh.state_change)) W(w, `Nên có state_change (${STATE_CHANGES.join('/')}) để cảnh có diễn biến rõ ràng.`);
      if (i === 0 && !s(sh.hook)) W(w, 'Shot đầu nên có hook để giữ chân người xem trong 3 giây đầu.');
      if (!s(sh.final_frame)) W(w, 'Thiếu final_frame (khung hình cuối clip).');

      const cast = Array.isArray(sh.cast) ? sh.cast : [];
      if (!cast.length && sh.empty_ok !== true && !spec.ivs) W(w, 'Shot không có nhân vật nào trong cast (nếu là cảnh cảnh vật/bối cảnh thì ghi empty_ok: true).');
      // Chuyển từ LỖI sang CẢNH BÁO: cho phép cảnh 3 người (gia đình, bạn bè, đồng nghiệp)
      if (cast.length > MAX_IN_FRAME) W(w, `Có ${cast.length} người trong khung. Khung hình dọc 9:16 có từ 3 người trở lên có thể bị chật; nên cân nhắc bố cục góc rộng hoặc tách shot.`);
      cast.forEach(id => { if (!chars[id]) E(w, `cast có id không tồn tại: "${id}".`); });

      // Bible: kiểm tra id và tính liên tục (trang phục, đạo cụ, bối cảnh) giữa các shot
      if (s(sh.location) && !locs[sh.location]) E(w, `location không có trong bible: "${sh.location}".`);
      const outfit = isObj(sh.outfit) ? sh.outfit : {};
      Object.keys(outfit).forEach(cid => {
        if (!cast.includes(cid)) W(w, `outfit nêu "${cid}" nhưng người này không có trong cast.`);
        const wd = wards[outfit[cid]];
        if (!wd) E(w, `outfit.${cid} dùng trang phục không có trong bible: "${outfit[cid]}".`);
        else if (wd.char !== cid) E(w, `Trang phục "${outfit[cid]}" thuộc nhân vật "${wd.char}", không phải "${cid}".`);
      });
      cast.forEach(cid => {
        if (!chars[cid]) return;
        const hasWard = Object.keys(wards).some(k => wards[k].char === cid);
        if (hasWard && !outfit[cid]) W(w, `"${nameOf(spec, cid)}" có trang phục trong bible nhưng shot chưa chọn outfit; dễ lệch trang phục.`);
        if (outfit[cid] && prevOutfit[cid] && prevOutfit[cid] !== outfit[cid] && sh.outfit_change_ok !== true && settingKey(sh) === prev.setting) {
          W(w, `"${nameOf(spec, cid)}" đổi trang phục (${prevOutfit[cid]} → ${outfit[cid]}) trong cùng bối cảnh; nếu có chủ ý hãy đặt outfit_change_ok: true.`);
        }
        if (outfit[cid]) prevOutfit[cid] = outfit[cid];
      });
      const shotProps = Array.isArray(sh.props) ? sh.props : [];
      shotProps.forEach(pid => { if (!propsById[pid]) E(w, `props có id không có trong bible: "${pid}".`); });
      prevProps.forEach(pid => {
        if (!shotProps.includes(pid) && propsById[pid] && sh.props_gone_ok !== true && settingKey(sh) === prev.setting) {
          W(w, `Đạo cụ "${propsById[pid].name}" có ở shot trước cùng bối cảnh nhưng không còn; nếu có chủ ý hãy đặt props_gone_ok: true.`);
        }
      });
      prevProps = shotProps;

      // layout cho cảnh 2 người
      const lay = isObj(sh.layout) ? sh.layout : {};
      if (cast.length === 2) {
        const [a, b] = cast;
        const la = lay[a], lb = lay[b];
        if (!isObj(la) || !isObj(lb)) W(w, 'Cảnh 2 người: nên có layout { side: left|right, facing: left|right } để model xếp hai người cân đối.');
        else {
          [[a, la], [b, lb]].forEach(([id, l]) => {
            if (l.side && !OPPOSITE[l.side]) W(w, `layout.${id}.side nên là left hoặc right.`);
            if (l.facing && !OPPOSITE[l.facing]) W(w, `layout.${id}.facing nên là left hoặc right.`);
          });
          if (la.side && lb.side && la.side === lb.side) W(w, 'Hai người đang xếp cùng một phía màn hình; model có thể tự cân bằng.');
          if (prev.setting && prev.setting === settingKey(sh) && prev.sides[a] && la.side && prev.sides[a] !== la.side && sh.axis_ok !== true) {
            W(w, `Nhân vật đổi phía màn hình so với shot trước trong cùng bối cảnh (trục 180 độ).`);
          }
        }
      }

      // 5 câu hỏi đạo diễn (quy tắc 28)
      const d = isObj(sh.director) ? sh.director : null;
      if (d) {
        if (cast.length === 2 && d.frame_favors && d.frame_favors !== 'none' && !s(d.frame_note)) W(w, 'director.frame_note: khung hình bênh người đó bằng cách nào trong CẢNH NÀY?');
        if (cast.length === 2 && d.winner && d.winner !== 'none' && d.frame_favors && d.frame_favors !== d.winner) W(w, 'Người thượng phong nên chiếm vị trí nổi bật hơn trong khung hình.');
      }

      // camera
      const cam = isObj(sh.camera) ? sh.camera : {};
      if (cam.size && !SIZES[cam.size]) W(w, `camera.size nên là ${Object.keys(SIZES).join('/')}.`);
      if (cam.move && !MOVES[cam.move]) W(w, `camera.move nên là ${Object.keys(MOVES).join('/')}.`);
      if (prev.size && cam.size && prev.size === cam.size && sh.same_size_ok !== true) W(w, `Hai shot liên tiếp cùng cỡ cảnh "${cam.size}".`);
      prev.size = cam.size || prev.size;

      // beats
      const beats = Array.isArray(sh.beats) ? sh.beats : [];
      if (!beats.length) E(w, 'Thiếu beats (diễn biến theo thời gian của cảnh).');
      if (beats.length > MAX_BEATS) W(w, `Có ${beats.length} beat. Tối đa 2 beat mỗi clip 5s–10s để model không bị loạn.`);
      let lastTo = 0;
      const levelHere = Object.assign({}, prev.level);
      beats.forEach((b, j) => {
        const bw = `${w} beat ${j + 1}`;
        if (!isObj(b)) return E(bw, 'Beat phải là đối tượng.');
        const from = Number(b.from), to = Number(b.to);
        if (!(from >= 0 && to > from && (!SECONDS.includes(secs) || to <= secs))) E(bw, `from/to không hợp lệ (0 ≤ from < to ≤ ${secs}).`);
        if (j === 0 && from !== 0) W(bw, 'Beat đầu nên bắt đầu ở giây 0.');
        if (j > 0 && from < lastTo) E(bw, 'Beat chồng giờ nhau.');
        lastTo = to || lastTo;
        if (!s(b.action)) E(bw, 'Thiếu action (hành động nhìn thấy trong cảnh).');
        if (PSYCHOLOGY.test(s(b.action))) W(bw, `action có vẻ miêu tả tâm lý ("${(PSYCHOLOGY.exec(s(b.action)) || [])[0]}"). Nên chuyển thành hành động/ánh mắt nhìn thấy.`);
        if (SNAKE_LABEL.test(s(b.action))) E(bw, 'action chứa nhãn VIẾT_HOA_gạch_dưới.');
        const emo = isObj(b.emotion) ? b.emotion : {};
        cast.forEach(id => {
          const e = emo[id];
          if (e && isObj(e)) {
            const lv = Number(e.level);
            // Chuyển từ LỖI sang CẢNH BÁO: bước ngoặt kịch tính đột ngột có thể nhảy cảm xúc
            if (id in levelHere && Math.abs(lv - levelHere[id]) > 1 && !(sh.expression_ok === true)) {
              W(bw, `Cường độ biểu cảm của "${nameOf(spec, id)}" thay đổi nhanh ${levelHere[id]} → ${lv} (nếu là cú sốc/bất ngờ thì hợp lý).`);
            }
            if (Number.isInteger(lv)) levelHere[id] = lv;
          }
        });
      });
      if (beats.length && SECONDS.includes(secs) && lastTo && lastTo < secs - 1.5) W(w, `Beat cuối kết thúc ở ${lastTo}s trong clip ${secs}s.`);
      Object.assign(prev.level, levelHere);

      // âm thanh
      if (spec.audio === 'narration') {
        const n = s(sh.narration);
        if (!n) W(w, 'Chế độ narration nhưng shot không có lời bình.');
        else {
          const need = words(n) / WORDS_PER_SEC;
          if (SECONDS.includes(secs) && need > secs * 1.15) W(w, `Lời bình ~${need.toFixed(1)}s nhưng clip chỉ ${secs}s. Hậu kỳ sẽ tự co giãn và giữ khung cuối.`);
        }
      }
      if (spec.audio === 'dialogue') {
        const hasText = (Array.isArray(sh.dialogue) && sh.dialogue.length) || s(sh.narration);
        if (!hasText) W(w, 'Shot chưa có câu thoại nào.');
      }
      if (spec.audio === 'caption' && s(sh.narration)) W(w, 'Chế độ caption: lời bình dùng làm phụ đề/caption lúc đăng.');

      prev.setting = settingKey(sh) || prev.setting;
      if (cast.length === 2 && isObj(lay[cast[0]]) && isObj(lay[cast[1]])) { prev.sides[cast[0]] = lay[cast[0]].side; prev.sides[cast[1]] = lay[cast[1]].side; }
      else if (settingKey(sh) !== prev.setting) prev.sides = {};
    });

    // mỗi clip cuối cùng nên là khoảng lặng/khung đóng (khung 3 hồi)
    return { errors, warnings, stats: { shots: spec.shots.length, seconds: total } };
  }

  const nameOf = (spec, id) => (spec.characters.find(c => c.id === id) || {}).name || id;

  function layoutSentence(spec, sh) {
    const cast = sh.cast || [];
    if (cast.length === 1) return `Chỉ một nhân vật trong khung: ${nameOf(spec, cast[0])}. Không có ai khác, không có người phía sau.`;
    if (cast.length === 2) {
      const lay = sh.layout || {};
      const left = cast.find(id => lay[id] && lay[id].side === 'left'), right = cast.find(id => lay[id] && lay[id].side === 'right');
      const dir = d => (d === 'left' ? 'sang trái' : 'sang phải');
      const gaze = id => (lay[id]?.gaze && lay[id]?.gaze !== 'none' ? `, ánh mắt hướng về ${nameOf(spec, lay[id].gaze)}${s(lay[id].why) ? ` (${s(lay[id].why)})` : ''}` : '');
      const leftChar = left || cast[0], rightChar = right || cast[1];
      return `Đúng 2 người trong khung, đứng song song trên cùng một mặt phẳng (không người nào đứng sau người kia): ` +
        `${nameOf(spec, leftChar)} ở bên trái khung, quay mặt ${dir(lay[leftChar]?.facing || 'right')}${gaze(leftChar)}; ` +
        `${nameOf(spec, rightChar)} ở bên phải khung, quay mặt ${dir(lay[rightChar]?.facing || 'left')}${gaze(rightChar)}. Cả hai nằm trọn trong khung.`;
    }
    if (cast.length >= 3) {
      return `Nhóm ${cast.length} nhân vật trong khung hình: ${cast.map(id => nameOf(spec, id)).join(', ')}. Bố cục tự nhiên trong không gian, cân đối hài hòa, không ai bị cắt nửa người ở mép khung.`;
    }
    return 'Cảnh không người, không có nhân vật nào trong khung.';
  }

  /** Chọn ảnh tham chiếu CHỈ cho nhân vật có mặt trong shot. library: [{ id|name, images:[path] }] */
  function refsFor(spec, sh, library) {
    const lib = Array.isArray(library) ? library : [];
    const out = [], missing = [];
    (sh.cast || []).forEach(id => {
      const c = spec.characters.find(x => x.id === id) || {};
      const entry = lib.find(l => (c.ref && (l.id === c.ref || l.name === c.ref)) || (l.name && c.name && l.name.normalize('NFC') === c.name.normalize('NFC')));
      if (entry && Array.isArray(entry.images) && entry.images.length) out.push({ id, name: c.name, images: entry.images.slice(0, 2) });
      else missing.push(id);
    });
    return { refs: out, missing };
  }

  /** Bible của một shot: bối cảnh, trang phục (theo từng người có mặt), đạo cụ + ảnh khóa lấy từ thư viện (mỗi mục tối đa 1 ảnh). */
  function bibleFor(spec, sh, library) {
    const b = isObj(spec.bible) ? spec.bible : {};
    const lib = Array.isArray(library) ? library : [];
    const arr = v => (Array.isArray(v) ? v : []);
    const pick = it => {
      const e = lib.find(l => s(it.ref) && (l.id === it.ref || l.name === it.ref));
      return e && Array.isArray(e.images) && e.images.length ? e.images.slice(0, 1) : [];
    };
    const loc = arr(b.locations).find(x => x.id === sh.location) || null;
    const outfit = isObj(sh.outfit) ? sh.outfit : {};
    const wards = (sh.cast || []).map(cid => arr(b.wardrobe).find(x => x.id === outfit[cid] && x.char === cid)).filter(Boolean);
    const props = arr(sh.props).map(pid => arr(b.props).find(x => x.id === pid)).filter(Boolean);
    const all = [];
    if (loc) all.push({ kind: 'bối cảnh', name: loc.name, images: pick(loc) });
    wards.forEach(wd => all.push({ kind: `trang phục của ${nameOf(spec, wd.char)}`, name: wd.name || wd.id, images: pick(wd) }));
    props.forEach(p => all.push({ kind: 'đạo cụ', name: p.name, images: pick(p) }));
    return {
      loc, wards, props,
      extra: all.filter(e => e.images.length),
      missing: all.filter(e => !e.images.length).map(e => `${e.kind} ${e.name}`)
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // CHẾ ĐỘ "LEAN" (opts.lean): prompt NGẮN, chỉ tả cái máy quay thấy, theo thứ tự của các tool đã chạy được (HaoHao, MuseFlow,
  // quy trình STRICT): ngoại hình -> bố cục -> đúng 1 chuyển động máy -> diễn biến theo giây -> khung cuối -> âm thanh -> phong cách.
  // Khác bản đầy đủ ở chỗ: (1) biểu cảm chỉ là HÌNH (cắt mọi vế "vì/do/bởi ..." vì Muse đọc lý do tâm lý thành diễn xuất quá tay);
  // (2) mô tả người có mặt bằng câu khẳng định, không dùng lệnh phủ định ("không có ai khác" dễ làm model nghĩ tới người khác);
  // (3) cỡ cảnh cận không đẩy máy sát: giữ người trọn trong khung; (4) bỏ các khối giải thích dài.
  // Ghi chú trung thực: chưa kiểm chứng bằng gen thật; đây là giả thuyết từ 4 nguồn đọc được.
  // ---------------------------------------------------------------------------------------------------------------
  // \b không dùng được với chữ có dấu, nên tách theo khoảng trắng: "..., vì vừa thấy ..." -> cắt từ "vì" trở đi.
  const REASON_CUT = /\s*[,;—-]?\s+(?:vì|do|bởi vì|bởi|nên|khiến|để)\s.*$/i;
  function visualOnly(t) { return tidy(s(t).replace(REASON_CUT, '')); }

  /**
   * BỨC TƯỜNG LỬA GIỌNG NÓI (SPEAKER FIREWALL) & CHẾ ĐỘ ÂM THANH TÁCH RỜI (AUDIO MODE B) — V5.1
   * - NARRATOR_001: chỉ đọc thuyết minh off-screen, không bao giờ xuất hiện trên hình, không đọc lời thoại nhân vật.
   * - VOICE_001..N: gắn cố định theo thứ tự nhân vật trong spec.characters, chỉ đọc câu thoại nhân vật, không thuyết minh.
   * - Phân chia khung giờ độc quyền (non-overlapping windows) cách nhau tối thiểu 0.2s để tránh chồng giọng / trôi giọng.
   */
  function buildSpeakerFirewall(spec, sh, opts) {
    const o = opts || {};
    const secs = Number(sh.seconds) || 6;
    const audioMode = o.audioMode || (spec.audio === 'mode_b' ? 'B' : (spec.audio === 'mode_a' ? 'A' : (spec.audio === 'dialogue' ? 'A' : 'B')));
    const narratorLock = {
      id: 'NARRATOR_001',
      role: 'off-screen narrator only',
      desc: s(spec.narrator_voice) || 'Vietnamese storytelling voice, warm, steady, dramatic pacing, strictly off-screen, never visible on camera'
    };
    const charVoices = {};
    (spec.characters || []).forEach((c, idx) => {
      const vid = `VOICE_${String(idx + 1).padStart(3, '0')}`;
      charVoices[c.id] = {
        id: vid,
        charId: c.id,
        name: c.name || c.id,
        desc: s(c.voice) || `Distinct Vietnamese voice for ${c.name || c.id}, consistent pitch and timbre across all shots`
      };
    });

    const rawEntries = [];
    if (s(sh.narration)) {
      rawEntries.push({
        kind: 'NARRATION',
        owner: 'NARRATOR_001',
        speakerName: 'Người dẫn chuyện (Off-screen)',
        text: s(sh.narration)
      });
    }
    const dlg = Array.isArray(sh.dialogue) ? sh.dialogue : [];
    dlg.forEach((d, idx) => {
      if (typeof d === 'string') {
        const cid = (sh.cast && sh.cast[idx % Math.max(1, sh.cast.length)]) || (spec.characters && spec.characters[0] && spec.characters[0].id) || 'char';
        const cv = charVoices[cid] || { id: `VOICE_${String(idx + 1).padStart(3, '0')}`, name: nameOf(spec, cid) };
        rawEntries.push({
          kind: 'CHARACTER_DIALOGUE',
          owner: cv.id,
          charId: cid,
          speakerName: cv.name,
          text: s(d)
        });
      } else if (isObj(d) && s(d.text)) {
        const cid = d.speaker || d.castId || d.character || (sh.cast && sh.cast[0]) || 'char';
        const cv = charVoices[cid] || { id: `VOICE_${String(idx + 1).padStart(3, '0')}`, name: nameOf(spec, cid) };
        rawEntries.push({
          kind: 'CHARACTER_DIALOGUE',
          owner: cv.id,
          charId: cid,
          speakerName: cv.name,
          text: s(d.text)
        });
      }
    });

    // Chia khung giờ độc quyền (Exclusive non-overlapping windows)
    const segments = [];
    if (rawEntries.length > 0) {
      const totalWords = rawEntries.reduce((acc, e) => acc + Math.max(1, words(e.text)), 0);
      const gap = rawEntries.length > 1 ? 0.2 : 0;
      const usableSecs = Math.max(1, secs - gap * (rawEntries.length - 1));
      let cursor = 0;
      rawEntries.forEach((e, i) => {
        const wRatio = Math.max(1, words(e.text)) / totalWords;
        const dur = i === rawEntries.length - 1
          ? Math.max(0.5, secs - cursor)
          : Math.max(0.8, Math.round(usableSecs * wRatio * 10) / 10);
        const from = Number(cursor.toFixed(1));
        const to = Number(Math.min(secs, cursor + dur).toFixed(1));
        segments.push({
          from,
          to,
          kind: e.kind,
          owner: e.owner,
          charId: e.charId || null,
          speakerName: e.speakerName,
          text: e.text,
          lineFormatted: e.kind === 'NARRATION'
            ? `[${from.toFixed(1)}s-${to.toFixed(1)}s] NARRATION OWNER=${e.owner} (off-screen) TEXT="${e.text}"`
            : `[${from.toFixed(1)}s-${to.toFixed(1)}s] CHARACTER_DIALOGUE OWNER=${e.owner} NAME="${e.speakerName}" (off-screen/no-lip-sync) TEXT="${e.text}"`
        });
        cursor = Math.min(secs, to + gap);
      });
    }

    return {
      audioMode,
      narratorLock,
      characterVoices: Object.values(charVoices),
      segments,
      rule: SPEAKER_FIREWALL_RULE
    };
  }

  function compileLean(spec, sh, o) {
    const { refs, missing } = refsFor(spec, sh, o.library);
    const bb = bibleFor(spec, sh, o.library);
    const cast = sh.cast || [];
    const names = cast.map(id => nameOf(spec, id));
    const fw = buildSpeakerFirewall(spec, sh, o);
    const L = [];
    L.push(`Video điện ảnh chân thực, thời lượng ${sh.seconds}s, một cảnh liền, một bối cảnh.`);
    const place = bb.loc ? [tidy(bb.loc.look), tidy(sh.setting)].filter(Boolean).join('; ') : tidy(sh.setting);
    L.push(`Bối cảnh: ${place}.`);
    if (cast.length && !(spec.ivs || o.ivs)) {
      cast.forEach(id => {
        const c = (spec.characters || []).find(x => x.id === id);
        if (!c) return;
        const wd = bb.wards.find(x => x.char === id);
        L.push(`${c.name}: ${tidy(c.look)}${wd ? `, mặc ${tidy(wd.desc)}` : ''}${Number(c.height_cm) ? `, cao ${Number(c.height_cm)} cm` : ''}.`);
      });
    } else if (spec.ivs || o.ivs) {
      const ivsType = IVS_SHOT_TYPES[(Number(sh.id || 1) - 1) % IVS_SHOT_TYPES.length];
      L.push(`Chiến lược hình ảnh độc lập (IVS - ${ivsType.name}): ${ivsType.desc}. Cảnh tự thân khép kín, không khóa mặt nhân vật từ clip trước, nhân vật trên hình hoàn toàn im lặng không nhép môi.`);
    }
    bb.props.forEach(p => L.push(`Đạo cụ ${p.name}: ${tidy(p.desc)}. Luôn nằm trọn trong khung và nhìn thấy rõ từ đầu đến cuối clip, kể cả khung cuối.`));
    const allRefs = (spec.ivs || o.ivs) ? bb.extra : refs.concat(bb.extra);
    if (allRefs.length) {
      let n = 0;
      const map = allRefs.map(r => { const from = n + 1; n += r.images.length; return `${r.images.length > 1 ? `ảnh ${from}–${n}` : `ảnh ${from}`} là ${r.kind ? r.kind + ' ' : ''}${r.name}`; });
      L.push(`Ảnh đính kèm: ${map.join('; ')}. Giữ đúng gương mặt, tóc, vóc dáng, trang phục như trong ảnh.`);
    }
    const lay = cast.length === 1 ? '' : layoutSentence(spec, sh).replace(/\s+$/g, '');
    L.push(`Trong khung chỉ có ${cast.length} người: ${names.join(' và ') || 'không ai'}; hậu cảnh là không gian trống người. ${lay}`.trim());
    L.push('Mọi người nằm trọn trong khung, mặt ở vùng giữa khung, cách xa mép trái và mép phải.');
    const cam = sh.camera || {};
    const close = cam.size === 'close';
    const STILL = 'máy cố định trên chân máy, giữ nguyên cỡ cảnh từ đầu đến cuối, không zoom, không đẩy vào, không lia';
    const moveTxt = (cam.move === 'push-in' && close) || cam.move === 'static' || !cam.move ? STILL : (MOVES[cam.move] || STILL);
    L.push(`Máy quay: ${SIZES[cam.size] || SIZES.medium}, ${moveTxt}.`);
    let lastEmo = '';
    (sh.beats || []).forEach(b => {
      const emo = cast.map(id => `${nameOf(spec, id)} ${visualOnly(((b.emotion || {})[id] || {}).label)}${((b.emotion || {})[id] || {}).level != null ? ` (mức ${((b.emotion || {})[id] || {}).level}/4)` : ''}`).join('; ');
      const showEmo = emo && emo !== lastEmo;
      lastEmo = emo;
      L.push(`${b.from}–${b.to}s: ${tidy(b.action)}${showEmo ? `. ${emo}` : ''}.`);
    });
    if (s(sh.final_frame)) L.push(`Khung cuối: ${tidy(sh.final_frame)}.`);
    if (spec.audio === 'mode_b' || o.audioMode === 'B') {
      L.push('Âm thanh (Chế độ B - Tách rời âm thanh): chỉ tạo hình ảnh điện ảnh sạch và tiếng động môi trường nhẹ; tuyệt đối không tạo giọng nói, không thuyết minh, không nhép môi (lồng tiếng VieNeu/Edge-TTS ở hậu kỳ).');
    } else if (spec.audio === 'dialogue' && !(spec.ivs || o.ivs)) {
      const dlg = Array.isArray(sh.dialogue) ? sh.dialogue : [];
      L.push('Âm thanh: tiếng động môi trường nhẹ, phân tách rõ giọng người dẫn chuyện ngoài khung hình và giọng nhân vật.');
      dlg.forEach(d => { L.push(typeof d === 'string' ? `- ${d}` : `- ${nameOf(spec, d.speaker || d.castId || d.character)}: "${d.text}"`); });
    } else {
      L.push('Âm thanh: tiếng động môi trường nhẹ, nhạc nền trầm, không lời nói, nhân vật trên hình không nhép môi.');
    }
    if (s(spec.style)) L.push(`Phong cách: ${tidy(spec.style)}.`);
    L.push(`Hình ảnh sạch, không chữ, logo hay phụ đề trên hình. ${NEGATIVE_V51} Làm ngay video mới, không hỏi lại.`);
    return {
      prompt: sanitizeMusePrompt(L.join('\n')), refs, imagePaths: allRefs.flatMap(r => r.images),
      missingRefs: (spec.ivs || o.ivs) ? [] : missing.map(id => nameOf(spec, id)), missingBible: bb.missing,
      narration: s(sh.narration), dialogue: sh.dialogue || [], seconds: Number(sh.seconds), lean: true,
      speakerFirewall: fw, postproduction_audio: fw.segments
    };
  }

  /**
   * Biên dịch một shot theo chuẩn单-line pipe-delimited V5.1 (Vietnamese Drama Muse Plugin V5.1).
   * Giữ đầy đủ các trường: PROMPT ### | SCENE | VISUAL | ACTION | CAMERA | LIGHTING | AUDIO MODE |
   * NARRATOR VOICE LOCK | CHARACTER VOICE REGISTRY | AUDIO TIMELINE | AMBIENCE/MUSIC |
   * STRICT SPEAKER FIREWALL | INDEPENDENT VISUAL | NEGATIVE.
   */
  function compileV51Shot(spec, sh, opts) {
    const o = opts || {};
    const bb = bibleFor(spec, sh, o.library);
    const cast = sh.cast || [];
    const fw = buildSpeakerFirewall(spec, sh, o);
    const idxNum = Number(sh.id) || 1;
    const promptId = `PROMPT ${String(idxNum).padStart(3, '0')}`;
    const place = bb.loc ? [tidy(bb.loc.look), tidy(sh.setting)].filter(Boolean).join('; ') : tidy(sh.setting);
    const isIvs = Boolean(spec.ivs || o.ivs);
    const ivsType = IVS_SHOT_TYPES[(idxNum - 1) % IVS_SHOT_TYPES.length];

    const visualParts = [];
    if (isIvs) {
      visualParts.push(`Independent visual storytelling (${ivsType.name}: ${ivsType.desc})`);
    }
    if (cast.length) {
      cast.forEach(id => {
        const c = (spec.characters || []).find(x => x.id === id);
        if (!c) return;
        const wd = bb.wards.find(x => x.char === id);
        visualParts.push(`${c.name} (${tidy(c.look)}${wd ? `, wearing ${tidy(wd.desc)}` : ''})`);
      });
    } else {
      visualParts.push('Atmospheric dramatic visual focus on environment and symbolic details');
    }
    bb.props.forEach(p => visualParts.push(`Key prop ${p.name}: ${tidy(p.desc)}`));
    visualParts.push(tidy(layoutSentence(spec, sh)));

    const actionParts = (sh.beats || []).map(b => {
      const emo = cast.map(id => {
        const em = (b.emotion || {})[id];
        return em && s(em.label) ? `${nameOf(spec, id)}: ${tidy(em.label)}` : '';
      }).filter(Boolean).join('; ');
      return `${b.from}-${b.to}s: ${tidy(b.action)}${emo ? ` (${emo})` : ''}`;
    });
    if (s(sh.final_frame)) actionParts.push(`Final frame: ${tidy(sh.final_frame)}`);

    const cam = sh.camera || {};
    const cameraDesc = `${SIZES[cam.size] || SIZES.medium}, ${MOVES[cam.move] || MOVES.static}, single continuous scene, no sudden cuts`;
    const lightingDesc = s(spec.style) ? tidy(spec.style) : 'Cinematic dramatic Vietnamese drama lighting, natural depth and realistic shadows';

    const blocks = [
      promptId,
      `SCENE: ${ sanitizeMusePrompt(place) }, duration ${sh.seconds}s`,
      `VISUAL: ${ sanitizeMusePrompt(visualParts.join('; ')) }`,
      `ACTION: ${ sanitizeMusePrompt(actionParts.join(' -> ')) }`,
      `CAMERA: ${ sanitizeMusePrompt(cameraDesc) }`,
      `LIGHTING: ${ sanitizeMusePrompt(lightingDesc) }`
    ];

    if (fw.audioMode === 'B' || spec.audio === 'mode_b' || spec.audio === 'caption') {
      blocks.push('AUDIO MODE=B: VISUAL AND SUBTLE AMBIENCE ONLY. NO SYNTHESIZED SPEECH, NO NARRATION, NO LIP-SYNC IN VIDEO GENERATION');
      if (fw.segments.length) {
        blocks.push(`AUDIO PRODUCTION REFERENCE (POSTPRODUCTION ONLY): ${fw.segments.map(seg => seg.lineFormatted).join(' ; ')}`);
      }
    } else {
      blocks.push('AUDIO MODE=A: STRICT SPEAKER FIREWALL OFF-SCREEN AUDIO');
      blocks.push(`NARRATOR VOICE LOCK: ${fw.narratorLock.id} = ${fw.narratorLock.desc}`);
      if (fw.characterVoices.length) {
        blocks.push(`CHARACTER VOICE REGISTRY: ${fw.characterVoices.map(cv => `${cv.id} (${cv.name}) = ${cv.desc}`).join(' ; ')}`);
      }
      if (fw.segments.length) {
        blocks.push(`AUDIO TIMELINE: ${fw.segments.map(seg => seg.lineFormatted).join(' ; ')}`);
      } else {
        blocks.push('AUDIO TIMELINE: Subtle environmental ambience only, no spoken lines in this clip');
      }
    }

    blocks.push('AMBIENCE/MUSIC: Subtle realistic room tone and low emotional underscoring, never overpowering voice');
    blocks.push(`STRICT SPEAKER FIREWALL: ${SPEAKER_FIREWALL_RULE}`);
    blocks.push('INDEPENDENT VISUAL: Self-contained cinematic reenactment shot illustrating the story beat; all on-screen figures remain silent with no mouth movement');
    blocks.push(`NEGATIVE: ${NEGATIVE_V51_FULL}`);

    return blocks.join(' | ');
  }

  /** Biên dịch một shot thành prompt. Chỉ gọi sau khi validate không còn lỗi. */
  function compileShot(spec, sh, opts) {
    const o = opts || {};
    if (o.lean) return compileLean(spec, sh, o);
    const { refs, missing } = refsFor(spec, sh, o.library);
    const bb = bibleFor(spec, sh, o.library);
    const cast = sh.cast || [];
    const isIvs = Boolean(spec.ivs || o.ivs);
    const fw = buildSpeakerFirewall(spec, sh, o);
    const lines = [];
    lines.push(`Tạo video chân thực, thời lượng ${sh.seconds}s, chuẩn điện ảnh.`);
    if (bb.loc) {
      const extraSetting = s(sh.setting) ? `; ${tidy(sh.setting)}` : '';
      lines.push(`Bối cảnh (cố định cho cả series, giữ đúng không gian, bố cục và đồ vật như các clip khác): ${tidy(bb.loc.look)}${extraSetting}.`);
    } else lines.push(`Bối cảnh: ${tidy(sh.setting)}.`);
    if (isIvs) {
      const ivsType = IVS_SHOT_TYPES[(Number(sh.id || 1) - 1) % IVS_SHOT_TYPES.length];
      lines.push(`Chiến lược hình ảnh độc lập (IVS — ${ivsType.name}): ${ivsType.desc}. Mỗi clip là một cảnh tái hiện kịch tính độc lập, không ép khóa mặt liên cảnh, tuyệt đối không nhép môi.`);
    }
    if (cast.length) {
      lines.push(isIvs
        ? 'Nhân vật trong cảnh tái hiện (ưu tiên góc quay bóng lưng, góc nghiêng, đôi bàn tay và cử chỉ hình thể; không nhép môi):'
        : 'Nhân vật (mô tả ngoại hình khi đứng yên, giữ y nguyên ở mọi clip):');
      cast.forEach(id => {
        const c = (spec.characters || []).find(x => x.id === id);
        if (!c) return;
        const wd = bb.wards.find(x => x.char === id);
        lines.push(`- ${c.name}: ${s(c.look)}${wd ? `; trang phục BẮT BUỘC trong cảnh này (thay thế mọi trang phục nêu ở trên): ${tidy(wd.desc)}` : ''}${Number(c.height_cm) ? `; cao ${Number(c.height_cm)} cm` : ''}.`);
      });
      if (cast.length === 2) lines.push('Tỉ lệ cơ thể và chiều cao tương đối tự nhiên, thực tế (natural realistic proportion, not exaggerated).');
    }
    if (bb.props.length) {
      lines.push('Đạo cụ (giữ nguyên hình dạng, màu sắc và cách cầm; không thêm đạo cụ nào khác ngoài danh sách):');
      bb.props.forEach(p => lines.push(`- ${p.name}: ${tidy(p.desc)}.`));
    }
    const allRefs = isIvs ? bb.extra : refs.concat(bb.extra);
    if (allRefs.length) {
      let n = 0;
      const map = allRefs.map(r => { const from = n + 1; n += r.images.length; return `${r.images.length > 1 ? `ảnh ${from}–${n}` : `ảnh ${from}`} là ${r.kind ? r.kind + ' ' : ''}${r.name}`; });
      lines.push(`Ảnh đính kèm: ${map.join('; ')}. Giữ đúng gương mặt, kiểu tóc, vóc dáng và trang phục như trong ảnh; không thêm người ngoài những người đã nêu.${bb.extra.length ? ' Ảnh bối cảnh, trang phục, đạo cụ chỉ để khóa không gian và đồ vật, không phải nhân vật thêm.' : ''}`);
    }
    lines.push(layoutSentence(spec, sh));
    const fav = sh.director && sh.director.frame_favors;
    if (cast.length === 2 && fav && fav !== 'none' && cast.includes(fav)) {
      const note = tidy(sh.director.frame_note);
      lines.push(note ? `Khung hình bênh ${nameOf(spec, fav)}: ${note}.` : `Khung hình bênh ${nameOf(spec, fav)}: ${nameOf(spec, fav)} chiếm vị trí nổi bật hơn trong khung, vẫn đứng cùng một mặt phẳng với người kia.`);
    }
    const cam = sh.camera || {};
    lines.push(`Máy quay: ${SIZES[cam.size] || SIZES.medium}, ${MOVES[cam.move] || MOVES.static}. Chỉ một bối cảnh duy nhất từ đầu đến cuối clip, không chuyển cảnh giữa chừng.`);
    lines.push('Diễn biến theo giây:');
    (sh.beats || []).forEach(b => {
      const emo = cast.map(id => {
        const em = (b.emotion || {})[id];
        return em && s(em.label) ? `${nameOf(spec, id)}: ${s(em.label)}` : '';
      }).filter(Boolean).join('; ');
      lines.push(`${b.from}–${b.to}s: ${tidy(b.action)}${emo ? `. Biểu cảm — ${emo}` : ''}.`);
    });
    if (s(sh.final_frame)) lines.push(`Khung hình cuối: ${tidy(sh.final_frame)}.`);
    if (spec.audio === 'mode_b' || o.audioMode === 'B') {
      lines.push('Âm thanh (Chế độ B - Tách rời âm thanh): chỉ tạo hình ảnh điện ảnh sạch và tiếng động môi trường tự nhiên thật nhẹ; tuyệt đối không tạo giọng nói, không thuyết minh, không hội thoại, nhân vật trên hình hoàn toàn im lặng không nhép môi (lời bình và thoại được lồng tiếng chuẩn đài ở hậu kỳ).');
    } else if (spec.audio === 'dialogue' && !isIvs && !o.speakerFirewall) {
      lines.push('Âm thanh: tiếng động môi trường tự nhiên và tiếng nói nhân vật; khẩu hình chuyển động nói tự nhiên khớp với lời thoại.');
      const dlg = Array.isArray(sh.dialogue) ? sh.dialogue : [];
      if (dlg.length) {
        lines.push('Lời thoại trong cảnh:');
        dlg.forEach(d => {
          if (typeof d === 'string') lines.push(`- ${d}`);
          else lines.push(`- ${nameOf(spec, d.speaker || d.castId || d.character)}: "${d.text}"`);
        });
      }
    } else {
      lines.push('Âm thanh (Bức tường lửa giọng nói - Speaker Firewall): tiếng động môi trường tự nhiên nhẹ và nhạc nền trầm; người dẫn chuyện hoàn toàn ở ngoài khung hình (off-screen), nhân vật trên hình tuyệt đối không nhép môi (no visible speaking, no lip-sync); lời bình và thoại phân vai được xử lý tách biệt.');
    }
    if (s(spec.style)) lines.push(`Phong cách: ${s(spec.style)}`);
    lines.push(`Chất lượng: bàn tay đúng giải phẫu, đủ năm ngón; cùng trang phục và kiểu tóc như khung hình mở đầu; không vật bị cắt dở ở mép khung; không chữ, phụ đề, logo, watermark; không chữ đọc được trên biển hiệu hay tường; không biến hình giữa chừng. ${NEGATIVE_V51}`);
    lines.push('Yêu cầu: tạo video MỚI hoàn toàn, làm ngay không hỏi lại.');

    const v51Prompt = compileV51Shot(spec, sh, o);
    const cleanMultiline = sanitizeMusePrompt(lines.join('\n'));
    return {
      prompt: o.v51Format === 'pipe' ? v51Prompt : cleanMultiline,
      v51Prompt,
      refs,
      imagePaths: allRefs.flatMap(r => r.images),
      missingRefs: isIvs ? [] : missing.map(id => nameOf(spec, id)),
      missingBible: bb.missing,
      narration: s(sh.narration),
      dialogue: sh.dialogue || [],
      seconds: Number(sh.seconds),
      ivs: isIvs,
      speakerFirewall: fw,
      postproduction_audio: fw.segments
    };
  }

  function compile(spec, opts) {
    const v = validate(spec);
    if (v.errors.length) return { ok: false, errors: v.errors, warnings: v.warnings, shots: [] };
    const shots = spec.shots.map(sh => compileShot(spec, sh, opts));
    const warnings = v.warnings.slice();
    shots.forEach((c, i) => { if (c.missingRefs.length) warnings.push({ where: `shots[${i}]`, msg: `Chưa có ảnh tham chiếu cho: ${c.missingRefs.join(', ')}. Chỉ có chữ thì Muse dễ lệch nhân vật; thêm nhân vật cùng tên và ảnh ở tab Tư liệu.` }); });
    shots.forEach((c, i) => { if (c.missingBible && c.missingBible.length) warnings.push({ where: `shots[${i}]`, msg: `Chưa có ảnh khóa cho: ${c.missingBible.join(', ')}. Chỉ có chữ thì bối cảnh/trang phục/đạo cụ dễ trôi giữa các clip; thêm ảnh ở tab Tư liệu và gán ref.` }); });
    return { ok: true, errors: [], warnings, shots, stats: v.stats, genre: genreFor(spec.genre || spec.title) };
  }

  function compileV51(spec, opts) {
    return compile(spec, Object.assign({}, opts, { v51Format: 'pipe' }));
  }

  /** Tạo sẵn SPEC mẫu chuẩn V5.1 theo 1 trong 9 thể loại kịch bản ăn khách (DRAMA_GENRES). */
  function generateGenreTemplate(genreId, opts) {
    const o = opts || {};
    const g = genreFor(genreId);
    const audio = AUDIO_MODES.includes(o.audio) ? o.audio : 'mode_b';
    const ivs = o.ivs !== undefined ? Boolean(o.ivs) : true;
    return {
      title: `Kịch bản ${g.name} — Chuẩn V5.1`,
      genre: g.id,
      audio,
      ivs,
      style: g.styleHint,
      characters: [
        { id: 'a', name: 'Nhân vật Chính', look: 'nam 32 tuổi, gương mặt góc cạnh, tóc đen gọn, mặc áo sơ mi trắng xắn tay, đeo đồng hồ dây da nâu', height_cm: 176 },
        { id: 'b', name: 'Đối phương', look: 'nữ 28 tuổi, tóc đen dài buộc thấp, mặc áo khoác dạ màu kem trang nhã, đeo nhẫn bạc ở ngón áp út', height_cm: 164 }
      ],
      bible: {
        locations: [
          { id: 'loc1', name: 'Phòng chính', look: `Không gian nội thất đặc trưng chủ đề ${g.name.toLowerCase()}, bàn gỗ sẫm màu ở giữa phòng, ánh đèn vàng ấm hắt từ bên trái tạo chiều sâu điện ảnh` }
        ],
        wardrobe: [
          { id: 'w_a', char: 'a', name: 'Trang phục A', desc: 'áo sơ mi trắng xắn tay gọn gàng, quần âu sẫm màu, đồng hồ dây da nâu' },
          { id: 'w_b', char: 'b', name: 'Trang phục B', desc: 'áo khoác dạ màu kem thanh lịch, đeo nhẫn bạc ở ngón áp út' }
        ],
        props: [
          { id: 'p1', name: 'Kỷ vật / Bằng chứng', desc: 'chiếc phong bì giấy kraft dày màu nâu vàng có dấu niêm phong đỏ đặt trên mặt bàn gỗ' }
        ]
      },
      shots: [
        {
          id: 1,
          seconds: 6,
          purpose: 'Mở đầu gây tò mò ngay lập tức bằng hành động đặt vật chứng lên bàn',
          hook: g.hookHint,
          state_change: 'power',
          location: 'loc1',
          setting: 'góc máy cận trung tập trung vào mặt bàn gỗ và đôi bàn tay',
          outfit: { a: 'w_a', b: 'w_b' },
          props: ['p1'],
          cast: ['a', 'b'],
          layout: {
            a: { side: 'left', facing: 'right', gaze: 'b', why: 'chủ động đưa ra quyết định' },
            b: { side: 'right', facing: 'left', gaze: 'a', why: 'bất ngờ trước vật chứng trên bàn' }
          },
          director: {
            wants: { a: 'buộc đối phương đối diện sự thật', b: 'giữ vẻ bình tĩnh che giấu sự thật' },
            winner: 'a',
            frame_favors: 'a',
            frame_note: 'Nhân vật Chính đứng ở tiền cảnh bên trái, bàn tay đặt chiếc phong bì vào đúng điểm vàng trung tâm khung hình'
          },
          camera: { size: 'close', move: 'push-in' },
          beats: [
            {
              from: 0,
              to: 3,
              action: 'Bàn tay của Nhân vật Chính chậm rãi đặt chiếc phong bì giấy kraft có dấu niêm phong đỏ xuống chính giữa mặt bàn gỗ',
              emotion: {
                a: { label: 'môi khép chặt thành một đường thẳng, ánh mắt nhìn thẳng không chớp', level: 2, because: 'đã nắm chắc bằng chứng trong tay' },
                b: { label: 'đôi vai khẽ cứng lại, ngón tay thu nhẹ về phía lòng bàn tay', level: 2, because: 'nhận ra món đồ quen thuộc' }
              }
            },
            {
              from: 3,
              to: 6,
              action: 'Đối phương dừng bước bên mép phải bàn, ánh mắt nhìn xuống chiếc phong bì dưới ánh đèn vàng tĩnh lặng',
              emotion: {
                a: { label: 'hai tay đan nhẹ trên mặt bàn, giữ tư thế tĩnh tại', level: 2, because: 'chờ phản ứng của đối phương' },
                b: { label: 'hàng mi khẽ hạ xuống nhìn chiếc phong bì, bàn tay siết nhẹ vạt áo', level: 3, because: 'bí mật sắp bị hé lộ' }
              }
            }
          ],
          final_frame: 'Chiếc phong bì nằm rõ nét giữa mặt bàn gỗ dưới ánh đèn vàng, hai đôi bàn tay ở hai phía đối lập hoàn toàn bất động',
          narration: 'Có những sự thật dù bị chôn giấu suốt nhiều năm, cuối cùng vẫn trở về trên chính chiếc bàn này.',
          dialogue: [
            { speaker: 'a', text: 'Mở ra xem đi, mọi thứ đều ở bên trong cả rồi.' }
          ]
        }
      ]
    };
  }

  /** Lệnh dán sang ChatGPT / Claude / Muse để sinh spec JSON chuẩn V5.1. Không chứa chi tiết của riêng truyện nào. */
  function directorPrompt(storyText, o) {
    const opt = o || {};
    const audio = opt.audio || 'narration';
    const n = opt.shots || 4;
    const g = genreFor(opt.genre || storyText);
    const useIvs = Boolean(opt.ivs);
    const audioRule = audio === 'mode_b'
      ? 'Chế độ âm thanh tách rời (Audio Mode B): Muse chỉ tạo hình ảnh điện ảnh sạch (không tạo giọng nói, không nhép môi). Vẫn viết đầy đủ trường "narration" (cho NARRATOR_001) và "dialogue" (cho VOICE_001..N) trong JSON để hệ thống hậu kỳ VieNeu-TTS / Edge-TTS tự động lồng tiếng chuẩn đài.'
      : (audio === 'narration'
        ? 'Mỗi shot có narration ngắn (khoảng 4 từ/giây, không dài hơn thời lượng shot); lời bình KHÔNG được lặp lại cái người xem vừa thấy.'
        : (audio === 'dialogue' || audio === 'mode_a'
          ? 'Bức tường lửa giọng nói (Speaker Firewall): tách biệt rõ lời dẫn chuyện "narration" (NARRATOR_001 off-screen) và "dialogue" (VOICE_001..N của nhân vật). Nhân vật trên hình tuyệt đối không nhép môi.'
          : 'Không voiceover; kể bằng caption lúc đăng.'));
    return [
      'Bạn là đạo diễn phim ngắn chuẩn V5.1 (Vietnamese Drama Muse V5.1). Chuyển đoạn truyện bên dưới thành SPEC JSON để máy gen video AI, theo ĐÚNG các luật sau và chỉ trả về JSON (không giải thích).',
      '',
      `THỂ LOẠI ĐỊNH HƯỚNG: ${g.name} (${g.label})`,
      `- Gợi ý Hook mở đầu: ${g.hookHint}`,
      `- Gợi ý Màu phim & Ánh sáng (style): ${g.styleHint}`,
      `- Gợi ý Hình ảnh tái hiện độc lập (IVS): ${g.ivsFocus}`,
      '',
      'LUẬT CỐT LÕI & 5 TRỤ CỘT V5.1:',
      '1. Chỉ viết cái máy quay quay được. Không miêu tả tâm lý ("anh buồn", "cô nhớ lại"); chuyển thành hành động/biểu cảm nhìn thấy. Lời bình/tóm tắt cốt truyện KHÔNG phải hình.',
      '2. Mỗi clip: một bối cảnh, một chuyển động camera, một mối quan hệ, tối đa 2 beat, tối đa 2 người trong khung. Từ 3 người trở lên: tách shot hoặc shot/reverse-shot.',
      '3. Hai người chung khung: xếp song song trái/phải, không ai đứng sau ai. Nhìn nhau thì người trái quay sang phải, người phải quay sang trái. Cùng một cặp trong cùng bối cảnh giữ nguyên phía màn hình.',
      '4. Mỗi người trong mỗi beat có biểu cảm mô tả bằng HÌNH ẢNH TÍCH CỰC (vd "môi khép thành một đường thẳng", không viết "không cười"), cường độ 0-4 và lý do. Cường độ chỉ đổi tối đa 1 bậc mỗi beat và mỗi điểm nối.',
      '5. Câu ngoại hình (look) chỉ gồm tuổi, mặt, tóc, trang phục, phụ kiện khi đứng yên. TUYỆT ĐỐI không có từ cảm xúc.',
      '6. Shot đầu có hook: áp lực/xung đột đang diễn ra ngay giây đầu. Mỗi shot phải đổi ít nhất một trạng thái (info/power/relation/emotion/risk). Shot cuối là khoảng lặng hoặc câu hỏi treo.',
      '7. Năm câu hỏi cho mỗi shot (director): nhân vật muốn gì; ai thượng phong; ai được cười với ai; ánh mắt hướng về ai và vì sao; khung hình bênh ai (người thượng phong phải chiếm ưu thế trong khung).',
      '8. Thời lượng mỗi shot chỉ 5, 6, 8 hoặc 10 giây. Luân phiên cỡ cảnh toàn/trung/cận. Không dùng nhãn VIẾT_HOA_gạch_dưới trong mô tả hình. Không chữ trên hình. CẤM đưa thông số kỹ thuật (fps, bitrate, codec, độ phân giải) vào mô tả.',
      `9. Kiểu âm thanh cho cả series: "${audio}". ${audioRule}`,
      '10. Khóa BIBLE một lần: mọi bối cảnh lặp lại, mọi bộ trang phục của từng nhân vật và mọi đạo cụ quan trọng khai báo trong "bible" (mô tả cụ thể từng món, màu, chất liệu, hình dạng). Mỗi shot chỉ tham chiếu bằng id (location, outfit, props), KHÔNG viết lại mô tả. Nhân vật giữ một bộ trang phục trong cùng bối cảnh trừ khi truyện có cảnh thay đồ. Đạo cụ đã xuất hiện phải còn trong các shot sau cùng bối cảnh trừ khi truyện nói mất đi.',
      `11. Chiến lược hình ảnh độc lập IVS (ivs=${useIvs}): ${useIvs ? 'BẬT IVS — Ưu tiên cận cảnh đôi bàn tay, đạo cụ, giọt nước mắt, bóng lưng quay đi, góc nghiêng silhouette hoặc đại cảnh giàu cảm xúc để triệt tiêu 100% lỗi trôi mặt và cấm tuyệt đối nhép môi (no lip-sync).' : 'Giữ liên tục nhân vật qua Bible & ảnh tham chiếu, đồng thời hạn chế lộ khẩu hình nói trực diện để tránh đơ miệng.'}`,
      '',
      `SỐ SHOT: khoảng ${n}. KHÔNG thêm bối cảnh, nhân vật, thời tiết, đạo cụ không có trong truyện.`,
      '',
      'MẪU JSON (giữ đúng tên khóa):',
      '{"title":"","genre":"' + g.id + '","ivs":' + (useIvs ? 'true' : 'false') + ',"audio":"' + audio + '","style":"một câu khóa màu phim và thời tiết, dán nguyên văn mọi clip","characters":[{"id":"a","name":"","look":"","height_cm":165}],',
      '"bible":{"locations":[{"id":"loc1","name":"","look":"không gian, đồ nội thất, màu sắc, ánh sáng cố định"}],"wardrobe":[{"id":"w1","char":"a","name":"","desc":"từng món quần áo, màu, chất liệu, phụ kiện"}],"props":[{"id":"p1","name":"","desc":"hình dạng, màu, kích thước"}]},',
      '"shots":[{"id":1,"seconds":6,"purpose":"người xem hiểu gì chỉ bằng hình","hook":"áp lực ngay giây đầu","state_change":"power","location":"loc1","setting":"chi tiết riêng của shot (có thể để trống)","outfit":{"a":"w1"},"props":["p1"],"cast":["a","b"],',
      '"layout":{"a":{"side":"left","facing":"right","gaze":"b","why":""},"b":{"side":"right","facing":"left","gaze":"a","why":""}},',
      '"director":{"wants":{"a":"","b":""},"winner":"a","frame_favors":"a","frame_note":""},',
      '"camera":{"size":"close","move":"push-in"},',
      '"beats":[{"from":0,"to":3,"action":"","emotion":{"a":{"label":"","level":2,"because":""},"b":{"label":"","level":1,"because":""}}}],',
      '"final_frame":"","narration":"","dialogue":[{"speaker":"a","text":""}]}]}',
      '',
      'TRUYỆN:',
      s(storyText)
    ].join('\n');
  }


  // ---------------------------------------------------------------------------------------------------------------
  // CHẾ ĐỘ "INFO": cảnh minh họa (B-roll) cho video thông tin / tuyển sinh. KHÔNG phải phim: không nhân vật chính, không cặp
  // tình cảm, không kịch tính. Số liệu và chữ KHÔNG nằm trong hình AI (hiển thị bằng phụ đề lúc dựng), vì AI vẽ chữ/số sai.
  // Chủ đề chọn theo từ khóa của lời bình: chỉ quyết định BỐI CẢNH minh họa, không bịa thêm sự kiện hay con số.
  // ---------------------------------------------------------------------------------------------------------------
  const INFO_TOPICS = [
    { key: 'health', re: /(bệnh viện|bác sĩ|y khoa|răng hàm mặt|điều dưỡng|y học|dược|sức khỏe|lâm sàng|giường bệnh|khám chữa)/i,
      setting: 'hành lang và phòng thực hành của một bệnh viện đại học hiện đại, sạch sẽ, ánh sáng tự nhiên',
      people: 'sinh viên và nhân viên y tế mặc blouse trắng, đi lại hoặc thực hành trên mô hình giảng dạy, ở khoảng cách trung và xa',
      beats: ['sinh viên mặc blouse trắng bước dọc hành lang sáng sủa, trao đổi nhỏ với giảng viên', 'một sinh viên thực hành thao tác trên mô hình giảng dạy dưới hướng dẫn của giảng viên'] },
    { key: 'tech', re: /(công nghệ thông tin|CNTT|trí tuệ nhân tạo|\bAI\b|khoa học dữ liệu|lập trình|phần mềm|máy tính)/i,
      setting: 'phòng máy tính hiện đại của trường đại học, ánh sáng tự nhiên, màn hình không hiển thị chữ đọc được',
      people: 'sinh viên ngồi làm việc nhóm trước máy tính, nhìn vào màn hình, ở khoảng cách trung',
      beats: ['hai sinh viên cùng thảo luận trước một màn hình, một người chỉ vào màn hình', 'cả nhóm sinh viên làm việc tập trung ở các bàn máy, giảng viên đi qua quan sát'] },
    { key: 'language', re: /(ngôn ngữ|tiếng anh|song ngữ|đối tác quốc tế|đối tác|trao đổi sinh viên|giao lưu|hội nhập)/i,
      setting: 'lớp học ngoại ngữ nhỏ trong trường đại học, bàn ghế xếp theo nhóm, ánh sáng tự nhiên',
      people: 'sinh viên trao đổi theo nhóm nhỏ, giảng viên đứng cạnh hướng dẫn, ở khoảng cách trung',
      beats: ['nhóm sinh viên trao đổi sôi nổi quanh một bàn, giảng viên lắng nghe', 'một sinh viên đứng trình bày ngắn trước lớp, các bạn khác theo dõi'] },
    { key: 'business', re: /(kinh tế|quản trị|kinh doanh|tài chính|ngân hàng|kế toán|thương mại|marketing|doanh nghiệp|logistics|luật)/i,
      setting: 'phòng thảo luận nhóm và thư viện của trường đại học, ánh sáng tự nhiên, bảng trắng không có chữ',
      people: 'sinh viên thảo luận nhóm quanh bàn lớn hoặc đọc sách trong thư viện, ở khoảng cách trung và xa',
      beats: ['nhóm sinh viên cùng xem tài liệu trên bàn thảo luận, trao đổi ý kiến', 'một sinh viên chọn sách ở giá thư viện rồi ngồi đọc'] },
    { key: 'campus', re: /./,
      setting: 'khuôn viên một trường đại học hiện đại, cây xanh, lối đi rộng, ánh sáng tự nhiên ban ngày',
      people: 'sinh viên đi bộ, trò chuyện từng nhóm nhỏ, ở khoảng cách trung và xa',
      beats: ['nhóm sinh viên đi bộ dọc lối đi giữa các tòa nhà, trò chuyện thoải mái', 'sinh viên ngồi học nhóm ngoài trời dưới tán cây'] }
  ];
  const INFO_SIZES = ['wide', 'medium', 'close'];
  // Chuyển động trung tính cho video thông tin (bảng MOVES của phim có chú thích kịch tính như 'tăng căng thẳng')
  const INFO_MOVES = { static: 'máy quay đứng yên', 'push-in': 'máy quay đẩy vào chậm' };

  function infoTopicFor(text) { const t = s(text); return INFO_TOPICS.find(x => x.re.test(t)) || INFO_TOPICS[INFO_TOPICS.length - 1]; }

  /** Biên dịch một cảnh B-roll. input: { text (lời bình), seconds, index } → { prompt, topic, imagePaths: [] , seconds } */
  function compileInfoShot(input) {
    const o = input || {};
    const secs = SECONDS.includes(Number(o.seconds)) ? Number(o.seconds) : 6;
    const idx = Number(o.index) || 0;
    const topic = infoTopicFor(o.text);
    const size = INFO_SIZES[idx % INFO_SIZES.length];
    const move = idx % 2 === 0 ? 'push-in' : 'static';
    const half = Math.max(2, Math.floor(secs / 2));
    const lines = [
      `Tạo video chân thực, thời lượng ${secs}s, chuẩn điện ảnh, cảnh minh họa cho video giới thiệu tuyển sinh đại học.`,
      `Bối cảnh: ${topic.setting}.`,
      `Chủ thể: ${topic.people}. Mọi người trong cảnh là sinh viên hoặc nhân sự trưởng thành, trang phục phù hợp môi trường; không ai nhìn thẳng vào ống kính; không có cặp đôi tình cảm hay cảnh lãng mạn.`,
      `Máy quay: ${SIZES[size]}, ${INFO_MOVES[move]}. Chỉ một bối cảnh duy nhất từ đầu đến cuối clip, không chuyển cảnh giữa chừng.`,
      'Diễn biến theo giây:',
      `0–${half}s: ${topic.beats[0]}.`,
      `${half}–${secs}s: ${topic.beats[1]}.`,
      'Khung hình cuối: cảnh vẫn trong cùng bối cảnh, người trong cảnh tiếp tục hoạt động tự nhiên.',
      'Âm thanh: tiếng động môi trường tự nhiên nhẹ; không lời nói, không hát, không nhạc có lời.',
      'Phong cách: màu phim điện ảnh sạch sẽ, ánh sáng tự nhiên mềm, tông ấm vừa phải.',
      `Chất lượng: bàn tay đúng giải phẫu, đủ năm ngón; không vật bị cắt dở ở mép khung; không chữ, số liệu, biển hiệu, logo, tên trường, phụ đề hay watermark trên hình; không chữ đọc được trên tường, bảng hay màn hình; không biến hình giữa chừng. ${NEGATIVE_V51}`,
      'Yêu cầu: tạo video MỚI hoàn toàn, làm ngay không hỏi lại.'
    ];
    return { prompt: lines.join('\n'), topic: topic.key, imagePaths: [], seconds: secs };
  }

  /**
   * TIMING ENGINE (V5.1 SKILL.md):
   * T = tổng số phút (totalMinutes), C = độ dài mỗi clip (6/10/15/30s).
   * N = ceil((T * 60) / C)
   */
  function computeTimingEngine(totalMinutes = 1, clipSeconds = 10) {
    const T = Math.max(0.1, Number(totalMinutes) || 1);
    const C = [5, 6, 8, 10, 15, 30].includes(Number(clipSeconds)) ? Number(clipSeconds) : 10;
    const totalSeconds = Math.round(T * 60);
    const clipCount = Math.max(1, Math.ceil(totalSeconds / C));
    const timeline = [];
    for (let i = 0; i < clipCount; i++) {
      const startSec = i * C;
      const endSec = Math.min(totalSeconds, (i + 1) * C);
      timeline.push({
        clipIndex: i + 1,
        promptId: `PROMPT ${String(i + 1).padStart(3, '0')}`,
        startSec,
        endSec,
        durationSec: Math.max(5, endSec - startSec || C)
      });
    }
    return { totalMinutes: T, totalSeconds, clipSeconds: C, clipCount, timeline };
  }

  /**
   * Tối ưu hóa câu lệnh thô (raw prompt) của người dùng sang chuẩn VIETNAMESE DRAMA MUSE V5.1:
   * - Lọc bỏ thông số định dạng video (9:16, 1080p, fps, bitrate...) khỏi phần mô tả hình ảnh.
   * - Tự động bóc tách các yêu cầu âm thanh/nhạc nền ("có nhạc nền nhẹ", "nhạc buồn", "tiếng mưa"...)
   *   đưa vào khối AMBIENCE/MUSIC riêng biệt để AI tuyệt đối không hiểu nhầm thành chữ/phụ đề vẽ lên hình.
   * - Nếu người dùng chỉ nhập câu ngắn kèm ảnh tham chiếu, tự động bổ sung mô tả chuyển động điện ảnh bám sát ảnh gốc.
   * - Luôn gắn quy tắc Speaker Firewall và NEGATIVE_V51_FULL ở cuối lệnh.
   */
  function optimizeRawPromptV51(rawPrompt, opts) {
    const o = opts || {};
    const hasImages = Boolean(o.hasImages);
    const secs = Number(o.seconds) || 10;
    const pipe = Boolean(o.pipe);
    const raw = sanitizeMusePrompt(rawPrompt || '');

    // Tách các cụm chỉ dẫn về nhạc nền / âm thanh ra khỏi câu mô tả hình ảnh
    const audioMatches = [];
    const audioRe = /(?:[,.;\-–—]\s*|\b)((?:có\s+|thêm\s+|ghép\s+|lồng\s+)?(?:nhạc nền|nhạc|âm thanh|tiếng động|tiếng mưa|tiếng gió|bgm)[^,.;\n]*)/gi;
    let visualClean = raw.replace(audioRe, (_m, g1) => {
      if (g1 && g1.trim()) audioMatches.push(g1.trim());
      return ' ';
    }).replace(/\s{2,}/g, ' ').replace(/^[,\s.;\-–—]+|[,\s.;\-–—]+$/g, '').trim();

    const musicInstruction = audioMatches.length
      ? audioMatches.join(', ')
      : 'Nhạc nền điện ảnh nhẹ nhàng sâu lắng (subtle emotional underscoring) và tiếng động môi trường tự nhiên';

    if (!visualClean || visualClean.length < 12) {
      visualClean = hasImages
        ? 'Chủ thể, gương mặt, trang phục và bối cảnh bám sát 100% ảnh tham chiếu đính kèm; chuyển động hình thể tự nhiên, ánh sáng điện ảnh có chiều sâu, giữ nguyên thần thái và chi tiết gốc từ đầu đến cuối cảnh'
        : 'Cảnh phim điện ảnh chân thực, bố cục có chiều sâu, ánh sáng tự nhiên sắc nét, chuyển động mượt mà trong một bối cảnh đồng nhất';
    } else if (hasImages && !/(ảnh tham chiếu|ảnh đính kèm|ảnh gốc)/i.test(visualClean)) {
      visualClean = `Bám sát 100% nhân vật, trang phục và bối cảnh trong ảnh tham chiếu đính kèm: ${visualClean}`;
    }

    if (pipe) {
      return [
        'PROMPT 001',
        `SCENE: Continuous realistic cinematic shot, duration ${secs}s`,
        `VISUAL: ${visualClean}`,
        'ACTION: Smooth natural physical movement and expressive body language from start to final frame, single continuous scene without random cuts',
        'CAMERA: Medium cinematic shot, slow push-in, steady framing',
        'LIGHTING: Realistic cinematic lighting with natural depth and consistent color grading',
        'AUDIO MODE=B: VISUAL AND SUBTLE AMBIENCE ONLY. NO SYNTHESIZED SPEECH, NO NARRATION, NO LIP-SYNC IN VIDEO GENERATION',
        `AMBIENCE/MUSIC: ${musicInstruction} (strictly audio background, NEVER render as text on screen)`,
        `STRICT SPEAKER FIREWALL: ${SPEAKER_FIREWALL_RULE}`,
        'INDEPENDENT VISUAL: Self-contained cinematic shot; all on-screen figures remain silent with no mouth movement',
        `NEGATIVE: ${NEGATIVE_V51_FULL}`
      ].join(' | ');
    }

    return [
      `Tạo video điện ảnh chân thực, thời lượng ${secs}s, một cảnh liền mạch:`,
      `- Hình ảnh & Chuyển động (VISUAL & ACTION): ${tidy(visualClean)}. Chuyển động vật lý mượt mà, giữ nguyên gương mặt, trang phục, bối cảnh và tỉ lệ giải phẫu chuẩn từ khung đầu đến khung cuối.`,
      '- Máy quay & Ánh sáng (CAMERA & LIGHTING): Góc máy điện ảnh ổn định, chuyển động máy êm, ánh sáng tự nhiên có chiều sâu.',
      `- Âm thanh & Nhạc nền (AMBIENCE/MUSIC): ${tidy(musicInstruction)}. (Đây là chỉ dẫn âm thanh nền, tuyệt đối KHÔNG viết thành chữ hay phụ đề lên video).`,
      `- Khóa giọng & Khẩu hình (SPEAKER FIREWALL): Nhân vật trên hình hoàn toàn không nhép môi, không tự phát sinh lời thoại ngoài kịch bản.`,
      `- Kiểm soát chất lượng (NEGATIVE V5.1): Tuyệt đối không chèn chữ, không phụ đề, không logo hay watermark lên hình. ${NEGATIVE_V51_FULL}`
    ].join('\n');
  }

  const api = {
    validate, compile, compileShot, compileV51, compileV51Shot, buildSpeakerFirewall,
    refsFor, bibleFor, directorPrompt, generateGenreTemplate, genreFor, sanitizeMusePrompt,
    compileInfoShot, infoTopicFor, computeTimingEngine, optimizeRawPromptV51,
    SECONDS, MAX_IN_FRAME, AUDIO_MODES, STATE_CHANGES,
    DRAMA_GENRES, IVS_SHOT_TYPES, NEGATIVE_V51, NEGATIVE_V51_FULL, SPEAKER_FIREWALL_RULE
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DramaCompiler = api;
})(this);
