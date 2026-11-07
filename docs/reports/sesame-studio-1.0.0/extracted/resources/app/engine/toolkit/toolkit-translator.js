const fs = require('fs');
const path = require('path');

const TOOLKIT_GOLDEN_SYSTEM_PROMPT = `[Vai trò]
Bạn là một chuyên gia dịch thuật và bản địa hóa (localization) ngôn ngữ hàng đầu, chuyên xử lý phụ đề video từ Tiếng Trung sang Tiếng Việt.

[Mục tiêu]
Nhiệm vụ của bạn là dịch văn bản được cung cấp sang một thứ tiếng Việt tự nhiên nhất, đúng chuẩn "văn nói hằng ngày" của người Việt Nam. Tuyệt đối không dịch máy móc (word-by-word), thô cứng hay mang hơi hướm văn dịch Google Translate.

[Quy tắc dịch thuật bắt buộc]
1. Quy tắc xưng hô (Cực kỳ quan trọng):
- Tự phân tích ngữ cảnh và mối quan hệ của nhân vật để chọn đại từ nhân xưng phù hợp nhất:
  + Hiện đại / Đô thị: Dùng "mày - tao", "anh - chú", "anh - em", "ông - tôi", "bà - tôi", "cậu - tớ".
  + Cổ trang / Cung đình / Tu tiên: Dùng "ta - ngươi", "tại hạ - các hạ", "huynh - đệ", "sư tôn - đồ nhi", "bổn tọa", "hoàng thượng - vi thần", "nương nương".
  + Lịch sự / Công sở: Dùng "tôi - anh/chị/cô/cậu", "sếp - tôi".
  + Tuyệt đối tránh dùng "bạn - tôi" một cách cứng nhắc trong mọi hoàn cảnh trừ khi là người lạ mới gặp.

2. Xử lý câu cảm thán & Từ đệm:
- Thêm các từ đệm tự nhiên của tiếng Việt vào cuối câu hỏi hoặc câu cảm thán: "nhé", "nha", "hả", "hửm", "đi", "nè", "chớ", "đấy", "vậy", "sao".

3. Xử lý từ lóng, chửi bậy & bộc lộ cảm xúc:
- Chuyển đổi các từ lóng ngoại ngữ sang từ lóng tương đương, thịnh hành của giới trẻ hoặc giang hồ Việt Nam: "Vãi chưởng", "Vãi nồi", "Mẹ kiếp", "Chết tiệt", "Đệch", "Đờ mờ", "Con bà nó", "Cái quái gì thế". Không né tránh các từ ngữ mạnh nếu bản gốc mang sắc thái tức giận hoặc bỗ bã.

4. Quy tắc đọc số và Tiền tệ (Đặc biệt cho tiếng Trung):
- Tiền tệ và số đếm phải quy đổi sang cách đọc thuần Việt, giúp Voice AI (TTS) đọc trôi chảy nhất:
  + "1 vạn" (1 万) -> "10 nghìn" hoặc "mười ngàn".
  + "100 vạn" -> "1 triệu".
  + "1 ức" -> "100 triệu".
  + Số đếm: Dịch thành chữ nếu là câu giao tiếp (VD: "hai người bọn mày"), giữ nguyên số nếu là thông số kỹ thuật/năm tháng.

5. Thành ngữ & Nghĩa bóng:
- Dịch thoát ý. Nếu bản gốc dùng thành ngữ, hãy tìm một thành ngữ Việt Nam có ý nghĩa tương đương để thay thế. Nếu không có, hãy giải nghĩa nó một cách ngắn gọn, dễ hiểu.

6. Ràng buộc đầu ra (Format Constraint):
- Giữ nguyên 100% định dạng thời gian (Timecode) của file SRT hoặc cấu trúc số thứ tự gốc.
- Trả về CHỈ VÀ DUY NHẤT văn bản đã dịch. Không giải thích, không thêm ghi chú, không chào hỏi, không thêm bất kỳ ký tự thừa nào.`;

// Parse nội dung SRT thành danh sách Cues
function parseSrt(srtContent) {
  const cues = [];
  const normalized = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length >= 2) {
      const id = lines[0].trim();
      const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/);
      if (timeMatch) {
        const startTime = timeMatch[1].replace('.', ',');
        const endTime = timeMatch[2].replace('.', ',');
        const text = lines.slice(2).join('\n').trim();
        cues.push({ id, startTime, endTime, text });
      }
    }
  }
  return cues;
}

// Chuyển Cues trở lại định dạng SRT chuẩn
function cuesToSrt(cues) {
  return cues.map((cue, idx) => {
    return `${idx + 1}\n${cue.startTime} --> ${cue.endTime}\n${cue.text}\n`;
  }).join('\n');
}

// Từ điển dịch thuật cục bộ cơ bản khi không có kết nối mạng / API Key
const LOCAL_ZH_VI_DICT = [
  [/万/g, ' vạn'],
  [/亿/g, ' ức'],
  [/你怎么了/g, 'Cậu làm sao vậy?'],
  [/你是谁/g, 'Mày là ai?'],
  [/我爱你/g, 'Anh yêu em'],
  [/对不起/g, 'Xin lỗi nhé'],
  [/没关系/g, 'Không sao đâu'],
  [/太好了/g, 'Tuyệt vời quá'],
  [/混蛋/g, 'Đồ khốn kiếp'],
  [/放开我/g, 'Buông tôi ra!'],
  [/救命/g, 'Cứu tôi với!'],
  [/等等我/g, 'Đợi tao với'],
  [/不可能/g, 'Không thể nào'],
  [/快走/g, 'Đi mau!'],
  [/不用了/g, 'Không cần đâu']
];

function localTranslateText(zhText) {
  let result = zhText;
  for (const [pattern, repl] of LOCAL_ZH_VI_DICT) {
    result = result.replace(pattern, repl);
  }
  return result;
}

const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const hasHan = (s) => HAN_RE.test(String(s || ''));
const NO_KEY_ERROR = 'Chưa có khóa dịch nên không dịch được phụ đề tiếng Trung. Hãy nhập khóa Gemini/OpenAI ở mục Dịch, hoặc dán SRT đã dịch sẵn.';

// Chạy các tác vụ song song tối đa `limit` luồng; kết quả giữ đúng thứ tự đầu vào.
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit | 0 || 1, items.length || 1));
  async function lane() {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: n }, lane));
  return results;
}

function stillUntranslated(origCues, outCues) {
  // Có câu gốc chứa chữ Hán mà đầu ra vẫn còn chữ Hán => chưa dịch được.
  return outCues.some((c, i) => hasHan(origCues[i].text) && hasHan(c.text));
}

/**
 * Dịch một mảng các cues phụ đề
 * options: { apiKey, provider: 'gemini'|'openai'|'local', genre, concurrency (mặc định 4), fetchImpl }
 */
async function translateCues(cues, options = {}) {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
  const provider = options.provider || 'gemini'; // 'gemini' | 'openai' | 'local'
  const genre = options.genre || 'modern'; // 'modern' | 'ancient' | 'office'
  const doFetch = options.fetchImpl || fetch;
  const concurrency = Math.max(1, Math.min(5, parseInt(options.concurrency, 10) || 4));

  const translatedCues = cues.map(c => ({ ...c }));

  if (!apiKey || provider === 'local') {
    for (const cue of translatedCues) cue.text = localTranslateText(cue.text);
    const changed = translatedCues.some((c, i) => c.text !== cues[i].text);
    const needs = cues.some(c => hasHan(c.text));
    if (stillUntranslated(cues, translatedCues) || (needs && !changed)) {
      return { ok: false, error: NO_KEY_ERROR };
    }
    return { ok: true, cues: translatedCues, method: 'local_rules' };
  }

  // Có khóa: gọi LLM theo lô 40 dòng, chạy song song (giữ đúng thứ tự vì ghi thẳng vào từng cue).
  const chunkSize = 40;
  const chunks = [];
  for (let i = 0; i < translatedCues.length; i += chunkSize) chunks.push(translatedCues.slice(i, i + chunkSize));

  await runPool(chunks, concurrency, async (chunk) => {
    const chunkText = chunk.map(c => `[${c.id}] ${c.text}`).join('\n');

    const prompt = `${TOOLKIT_GOLDEN_SYSTEM_PROMPT}

[Thể loại bối cảnh]: ${genre === 'ancient' ? 'Cổ trang / Cung đấu / Tu tiên' : 'Đô thị hiện đại / Ngôn tình / Tổng tài'}

Hãy dịch danh sách các câu phụ đề sau đây sang Tiếng Việt. Giữ nguyên định dạng [ID] ở đầu mỗi câu:

${chunkText}`;

    try {
      let translatedText = '';
      if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const res = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        });
        const json = await res.json();
        translatedText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else {
        const res = await doFetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }]
          })
        });
        const json = await res.json();
        translatedText = json?.choices?.[0]?.message?.content || '';
      }

      const lines = translatedText.split('\n');
      for (const line of lines) {
        const match = line.match(/^\[(\d+)\]\s*(.+)$/);
        if (match) {
          const targetCue = chunk.find(c => c.id === match[1]);
          if (targetCue) targetCue.text = match[2].trim();
        }
      }
    } catch (err) {
      console.error('Lỗi gọi AI dịch phụ đề:', err);
      for (const c of chunk) c.text = localTranslateText(c.text);
    }
  });

  if (stillUntranslated(cues, translatedCues)) {
    return { ok: false, error: 'Dịch chưa thành công (khóa dịch sai/hết hạn hoặc mạng lỗi): vẫn còn câu chữ Hán. Hãy kiểm tra khóa Gemini/OpenAI hoặc nhập SRT đã dịch.' };
  }
  return { ok: true, cues: translatedCues, method: provider };
}

module.exports = {
  TOOLKIT_GOLDEN_SYSTEM_PROMPT,
  parseSrt,
  cuesToSrt,
  translateCues,
  localTranslateText,
  runPool,
  hasHan
};
