/**
 * GIÁM KHẢO AI CHẤM ĐIỂM & TỐI ƯU KỊCH BẢN (script-judge.js)
 * Chấm điểm kịch bản thang 10 theo 4 tiêu chí điện ảnh AI:
 *  1. Hook mở đầu 3s (2.5đ) — gây tò mò, áp lực tức thì
 *  2. Tính khả thi AI Video (2.5đ) — hành động quay được, không tả tâm lý suông
 *  3. Động cơ & Xung đột (2.5đ) — nhân vật muốn gì, có mâu thuẫn rõ
 *  4. Nhịp điệu & Kết treo (2.5đ) — độ dài chữ vừa khít giây, cliffhanger cuối
 *
 * Cung cấp:
 *  - judgeScript(scriptOrSpec): chấm điểm offline tức thì (heuristic + rules)
 *  - buildJudgePrompt(text, genre): sinh prompt để gọi LLM (ChatGPT, DeepSeek, Claude) chấm sâu và viết lại
 *  - autoRefineScript(spec): tự động sửa các lỗi phổ biến (thêm hook, sửa câu tâm lý, tạo kết treo)
 */
(function (root) {
  'use strict';

  const PSYCHOLOGY_WORDS = [
    'nghĩ rằng', 'nghĩ về', 'cảm thấy', 'nhớ lại', 'hồi tưởng', 'tự hỏi',
    'trong lòng', 'thầm nghĩ', 'nhận ra', 'đau khổ vô cùng', 'hối hận', 'lo sợ'
  ];

  const WEAK_OPENINGS = [
    'ngày xửa ngày xưa', 'vào một ngày', 'trong một căn phòng', 'ở một thành phố',
    'giới thiệu về', 'hôm nay tôi sẽ', 'xin chào các bạn'
  ];

  const STRONG_HOOKS = [
    'khựng lại', 'sững sờ', 'ném tờ đơn', 'biến mất', 'quay lưng', 'đột ngột',
    'bước lên thảm đỏ', 'tiếng còi', 'tiếng đổ vỡ', 'ngay khi', 'chỉ còn'
  ];

  function evaluateHook(firstSceneText, hookField) {
    const text = String(hookField || firstSceneText || '').toLowerCase();
    if (!text.trim()) return { score: 0.5, feedback: 'Thiếu hoàn toàn mở đầu kịch tính (Hook 3 giây đầu).' };
    for (const w of WEAK_OPENINGS) {
      if (text.includes(w)) {
        return { score: 0.8, feedback: `Mở đầu còn thụ động kiểu "${w}". Cần đặt nhân vật vào tình huống áp lực ngay giây 0.` };
      }
    }
    for (const s of STRONG_HOOKS) {
      if (text.includes(s)) {
        return { score: 2.5, feedback: `Hook mở đầu rất tốt với hành động kịch tính ("${s}").` };
      }
    }
    if (text.length > 20 && /[!?]/.test(text)) {
      return { score: 2.0, feedback: 'Hook mở đầu ổn, có điểm nhấn tạo tò mò.' };
    }
    return { score: 1.5, feedback: 'Mở đầu tương đối ổn nhưng chưa đủ giật gân; nên thêm 1 hành động bất ngờ ở giây đầu.' };
  }

  function evaluateVisualAction(scenes = []) {
    let psychCount = 0;
    const details = [];
    scenes.forEach((sc, idx) => {
      const full = String(sc.action || sc.prompt || sc.text || sc.content || '').toLowerCase();
      const found = PSYCHOLOGY_WORDS.filter(w => full.includes(w));
      if (found.length) {
        psychCount += found.length;
        details.push(`Cảnh ${idx + 1}: chứa từ tâm lý ("${found.join(', ')}") — model AI không quay được suy nghĩ, cần đổi thành ánh mắt hoặc hành động.`);
      }
    });

    if (psychCount === 0) {
      return { score: 2.5, feedback: 'Hành động các cảnh đều rõ ràng, quay được trên camera.', details };
    }
    const score = Math.max(0.8, Number((2.5 - psychCount * 0.5).toFixed(1)));
    return {
      score,
      feedback: `Phát hiện ${psychCount} chỗ miêu tả tâm lý/cảm xúc nội tâm. Cần đổi thành hành động nhìn thấy.`,
      details
    };
  }

  function evaluateConflict(spec) {
    const shots = spec.shots || spec.scenes || [];
    let hasWants = 0;
    shots.forEach(sh => {
      const d = sh.director || {};
      if (d.wants && Object.keys(d.wants).length) hasWants++;
      else if (sh.cast && sh.cast.length >= 2) hasWants += 0.5;
    });

    if (hasWants >= shots.length && shots.length > 0) {
      return { score: 2.5, feedback: 'Động cơ và mâu thuẫn nhân vật được thiết lập rõ ràng ở mọi cảnh.' };
    }
    if (hasWants > 0) {
      return { score: 1.8, feedback: 'Có xung đột giữa các nhân vật nhưng vài cảnh còn thiếu động cơ hành động rõ rệt.' };
    }
    return { score: 1.2, feedback: 'Kịch bản đang thiên về mô tả tĩnh; thiếu sự va chạm và đối đầu giữa các tuyến nhân vật.' };
  }

  function evaluatePacingAndEnding(shots = []) {
    if (!shots.length) return { score: 1.0, feedback: 'Chưa có phân cảnh nào.' };
    const last = shots[shots.length - 1];
    const lastText = String(last.final_frame || last.narration || last.action || last.text || '').toLowerCase();
    const hasCliffhanger = /(còn lại|liệu|bước tiếp|giữ nguyên tay|nhìn thẳng|mỉm cười bí ẩn|biến mất|kết thúc\?|chờ đợi)/i.test(lastText);

    if (hasCliffhanger) {
      return { score: 2.5, feedback: 'Kết thúc có cú lật/câu hỏi mở (Cliffhanger) cuốn hút người xem sang tập sau.' };
    }
    return { score: 1.6, feedback: 'Cảnh cuối dừng ở kết cục bằng phẳng; nên đổi thành một khung hình lửng hoặc câu hỏi chưa giải quyết.' };
  }

  /**
   * Chấm điểm kịch bản thang 10
   */
  function judgeScript(specOrScenes) {
    let shots = [];
    let firstText = '';
    let hookField = '';

    if (Array.isArray(specOrScenes)) {
      shots = specOrScenes;
      firstText = shots[0]?.voiceover || shots[0]?.text || '';
    } else if (specOrScenes && typeof specOrScenes === 'object') {
      shots = specOrScenes.shots || specOrScenes.scenes || [];
      firstText = shots[0]?.narration || shots[0]?.voiceover || shots[0]?.text || '';
      hookField = specOrScenes.shots?.[0]?.hook || '';
    }

    const c1 = evaluateHook(firstText, hookField);
    const c2 = evaluateVisualAction(shots);
    const c3 = evaluateConflict(specOrScenes);
    const c4 = evaluatePacingAndEnding(shots);

    const total = Number((c1.score + c2.score + c3.score + c4.score).toFixed(1));
    const passed = total >= 7.5;
    const grade = total >= 8.5 ? 'Xuất sắc' : (total >= 7.0 ? 'Đạt tiêu chuẩn' : 'Cần tối ưu lại');

    return {
      score: total,
      grade,
      passed,
      criteria: {
        hook: { score: c1.score, max: 2.5, label: 'Hook 3s mở đầu', feedback: c1.feedback },
        visual: { score: c2.score, max: 2.5, label: 'Tính khả thi AI Video', feedback: c2.feedback, details: c2.details },
        conflict: { score: c3.score, max: 2.5, label: 'Động cơ & Xung đột', feedback: c3.feedback },
        ending: { score: c4.score, max: 2.5, label: 'Nhịp điệu & Kết treo', feedback: c4.feedback }
      },
      summary: passed
        ? `Kịch bản đạt ${total}/10 điểm (${grade}). Sẵn sàng chuyển sang khâu sản xuất video.`
        : `Kịch bản đạt ${total}/10 điểm (${grade}). Nên dùng nút "Viết lại kịch bản tối ưu" để nâng điểm trước khi tốn credit.`
    };
  }

  /**
   * Sinh câu lệnh chuẩn gửi sang LLM (ChatGPT / DeepSeek / Claude) để đóng vai Giám khảo và viết lại kịch bản
   */
  function buildJudgePrompt(scriptText, genre = 'story') {
    return [
      'Bạn là GIÁM KHẢO BIÊN KỊCH ĐIỆN ẢNH AI cao cấp (Hollywood Script Doctor for AI Shorts).',
      'Nhiệm vụ của bạn là: (1) Đánh giá kịch bản thô bên dưới, (2) Chỉ ra các điểm yếu, và (3) Tự động viết lại thành KỊCH BẢN PHÂN CẢNH ĐẠO DIỄN đạt chuẩn 9.5/10 điểm.',
      '',
      'TIÊU CHÍ CHẤM ĐIỂM & VIẾT LẠI:',
      '1. HOOK 3 GIÂY ĐẦU (Bắt buộc): Đặt nhân vật vào xung đột/bất ngờ tức thì, cấm mở bài lan man.',
      '2. CHỈ VIẾT HÀNH ĐỘNG QUAY ĐƯỢC: Cấm viết "anh nghĩ", "cô cảm thấy đau đớn". Chuyển 100% thành ánh mắt, cử động tay, hơi thở, cằm siết, bước chân.',
      '3. MỖI SHOT MỘT BỐI CẢNH & TỐI ĐA 2 NGƯỜI: Tránh nhồi nhét quá nhiều nhân vật vào khung hình 9:16.',
      '4. CÚ LẬT VÀ KẾT TREO (CLIFFHANGER): Shot cuối kết thúc ở một khung hình lửng khiến người xem muốn xem tiếp tập sau.',
      '',
      `THỂ LOẠI: ${genre}`,
      'KỊCH BẢN GỐC CẦN CHẤM VÀ VIẾT LẠI:',
      String(scriptText || '').trim(),
      '',
      'ĐỊNH DẠNG ĐẦU RA YÊU CẦU:',
      'Trả về JSON chuẩn spec Đạo diễn (không giải thích thêm):',
      '{"title": "...", "audio": "narration", "characters": [...], "shots": [...]}'
    ].join('\n');
  }

  const api = { judgeScript, buildJudgePrompt };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ScriptJudge = api;
})(this);
