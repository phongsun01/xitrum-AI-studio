/**
 * KỊCH BẢN AFFILIATE BÁM NGUỒN — không biến một landing page thành review "đã dùng thử" hay "khuyến mãi có hạn".
 *
 * Chỉ dùng title / câu mô tả / tính năng / giá / chính sách có trên trang. Giá hoặc chính sách biến động:
 * đưa lời bình dưới dạng "Trang bán hàng ghi..." (do người bán cung cấp, CHƯA được xác minh độc lập),
 * và yêu cầu người dùng duyệt trước khi gửi AI. Không đủ dữ kiện → lời ngắn, hình B-roll lấp khoảng trống.
 * Video AI không nhận là footage quay/test thật. Đây là trình tạo bản NHÁP, không phải kiểm chứng sản phẩm.
 */
const normalize = v => String(v == null ? '' : v).replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const compact = v => normalize(v).replace(/[.!?]+$/, '');
const unique = arr => [...new Set(arr.filter(Boolean))];
const PRICE = /(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(k|nghìn|ngàn|₫|đ|vnđ|đồng)(?![a-zà-ỹ])/gi;
function vnd(num, unit) { return Number(num.replace(/[.,]/g, '')) * (/^(k|nghìn|ngàn)$/i.test(unit) ? 1000 : 1); }
function displayVnd(n) { return n >= 1e6 ? `${(n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} triệu đồng` : `${Math.round(n / 1000)} nghìn đồng`; }

function priceEvidence(priceLines) {
  const rows = [];
  for (const raw of priceLines) {
    const line = normalize(raw);
    let m; PRICE.lastIndex = 0;
    while ((m = PRICE.exec(line))) {
      const before = line.slice(Math.max(0, m.index - 20), m.index);
      if (/(giá gốc|tiết kiệm|phí ship|giảm|voucher)\s*$/i.test(before)) continue;
      const n = vnd(m[1], m[2]);
      if (n >= 10000) rows.push({ value: n, source: line });
    }
  }
  const values = unique(rows.map(r => String(r.value)));
  if (values.length !== 1) return { price: null, source: '', ambiguous: values.length > 1 };
  return { price: Number(values[0]), source: rows[0].source, ambiguous: false };
}

function sourceFacts(lines, title) {
  const bare = normalize(title).toLowerCase();
  const seen = new Set();
  return lines.map(normalize).filter(x => {
    if (!x || x.length < 20 || x.length > 220 || x.toLowerCase() === bare) return false;
    if (/(giá|đặt hàng|mua ngay|freeship|hotline|số lượng|đã bán|đánh giá|trải nghiệm|review|ưu đãi|khuyến mãi|bảo hành|đổi trả)/i.test(x)) return false;
    if (seen.has(x)) return false; seen.add(x); return true;
  }).slice(0, 3);
}

function groundedOffers(policies) {
  const out = [];
  for (const raw of policies) {
    const line = normalize(raw);
    // Điều kiện/đơn tối thiểu, phủ định, ngày hết hạn mơ hồ: KHÔNG rút thành câu quyền lợi vô điều kiện.
    // Để nguyên dòng trong rawLines cho người dùng tự kiểm và biên tập thủ công.
    if (/hết hạn|đã kết thúc|không còn áp dụng|không\s+(?:có\s+)?(?:freeship|miễn phí|bảo hành|COD)|chưa\s+(?:có\s+)?(?:freeship|miễn phí|bảo hành|COD)|đến ngày\s+\d|đơn\s+(?:hàng\s+)?(?:từ|trên)|cho đơn|tối thiểu|chỉ khi|nếu\s+đặt/i.test(line)) continue;
    if (/miễn phí (vận chuyển|giao hàng|ship)|freeship/i.test(line)) out.push({ label: 'miễn phí vận chuyển', source: line });
    const warranty = /bảo hành\s*(\d+\s*(tháng|năm))/i.exec(line);
    if (warranty) out.push({ label: `bảo hành ${warranty[1]}`, source: line });
    if (/thanh toán khi nhận hàng|\bCOD\b/i.test(line)) out.push({ label: 'thanh toán khi nhận hàng', source: line });
  }
  return unique(out.map(x => x.label)).map(label => out.find(x => x.label === label)).slice(0, 3);
}

const VISUAL = {
  head: 'B-roll sản phẩm do AI minh họa: cận cảnh sản phẩm trên nền trung tính, ánh sáng mềm, máy quay đẩy vào chậm, giữ tỷ lệ và chất liệu theo ảnh tham chiếu nếu có',
  detail: 'B-roll sản phẩm do AI minh họa: máy quay lia ngang chậm qua hình dáng và chất liệu, không vẽ thông số, logo hay chữ trên hình',
  close: 'B-roll sản phẩm do AI minh họa: sản phẩm đứng yên trên mặt bàn, góc máy rộng hơn để thấy toàn bộ, ánh sáng tự nhiên, không quay người tự nhận đã dùng thử'
};
const SHOT_TAIL = '. Một bối cảnh, một chuyển động máy, không chữ đọc được, không giá/số liệu/ưu đãi trên hình, không logo giả. Đây là cảnh AI minh họa sản phẩm, không có người dẫn nói vào máy.';

function generateScriptsFromProduct(scrapedData, opts = {}) {
  const title = normalize(scrapedData?.title) || 'Sản phẩm';
  const imageList = (scrapedData?.images || []).filter(Boolean).slice(0, 16);
  const rawLines = String(scrapedData?.textSnippet || '').split(/\r?\n/).map(normalize).filter(Boolean);
  const prices = (scrapedData?.prices || []).map(normalize);
  const policies = (scrapedData?.policies || []).map(normalize);
  const facts = sourceFacts(rawLines, title);
  const price = opts.noPrice ? { price: null, source: '', ambiguous: false } : priceEvidence(prices);
  const offers = groundedOffers(policies);
  const seconds = [5, 6, 8, 10].includes(Number(opts.sceneSecs)) ? Number(opts.sceneSecs) : 10;
  const two = Number(opts.scenes) === 2;
  const source = normalize(scrapedData?.url);
  const warning = [
    'Kịch bản là bản nháp từ thông tin người bán trên landing page, chưa xác minh độc lập. Kiểm tra tính năng, giá và chính sách tại nguồn trước khi đăng.',
    price.ambiguous && !opts.noPrice ? 'Trang có nhiều mức giá/combo khác nhau; app không đoán giá nào là giá hiện tại, đã bỏ giá khỏi lời bình.' : '',
    !facts.length ? 'Trang ít mô tả; app không bịa thêm công dụng, lời bình sẽ ngắn hơn thời lượng clip.' : ''
  ].filter(Boolean);
  const base = `Đây là ${title}.`;
  const detail = facts[0] ? `Theo mô tả trên trang sản phẩm, ${compact(facts[0])}.` : 'Xem hình dáng và chi tiết sản phẩm trong video minh họa.';
  const extra = facts[1] ? `Trang sản phẩm còn ghi: ${compact(facts[1])}.` : 'Thông tin chi tiết có ở trang sản phẩm.';
  const cta = 'Xem mô tả và điều kiện hiện hành tại link sản phẩm trước khi đặt.';
  const priceLine = price.price ? `Trang bán hàng đang niêm yết ${displayVnd(price.price)}; kiểm tra lại giá khi đặt.` : '';
  const offerLine = offers.length ? `Trang bán hàng ghi ${offers.map(x => x.label).join(', ')}; kiểm tra điều kiện hiện hành tại link.` : '';
  const mk = (voiceover, visual, evidence) => ({ voiceover, musePrompt: visual + SHOT_TAIL, evidence: evidence || [], image: imageList[0] || '' });
  const shot = (index, voiceover, visual, evidence) => ({ index, time: `${(index - 1) * seconds}–${index * seconds}s`, ...mk(voiceover, visual, evidence) });
  const scripts = [];
  const add = (name, lines, evidence) => {
    const seq = two ? [lines[0], lines[2]] : lines;
    scripts.push({ id: `script_${scripts.length + 1}`, name, scenes: seq.map((x, i) => shot(i + 1, x.voice, [VISUAL.head, VISUAL.detail, VISUAL.close][two && i === 1 ? 2 : i], x.evidence)), evidence: evidence || [], needsReview: true });
  };

  add('Giới thiệu sản phẩm (bám nguồn)', [
    { voice: base, evidence: [title] },
    { voice: detail, evidence: facts[0] ? [facts[0]] : [] },
    { voice: cta, evidence: [] }
  ]);
  if (facts.length >= 2) add('Chi tiết nổi bật (bám nguồn)', [
    { voice: base, evidence: [title] },
    { voice: detail + ' ' + extra, evidence: facts.slice(0, 2) },
    { voice: cta, evidence: [] }
  ]);
  if ((price.price && !opts.noPrice) || offers.length) add('Giá/điều kiện do người bán công bố', [
    { voice: base, evidence: [title] },
    { voice: [priceLine, offerLine].filter(Boolean).join(' '), evidence: [price.source, ...offers.map(o => o.source)].filter(Boolean) },
    { voice: cta, evidence: [] }
  ]);
  const silent = [
    shot(1, '', VISUAL.head, []), shot(2, '', VISUAL.detail, []), shot(3, '', VISUAL.close, [])
  ];
  scripts.push({ id: `script_${scripts.length + 1}`, name: 'B-roll sản phẩm AI (không lời)', scenes: two ? [silent[0], { ...silent[2], index: 2, time: `${seconds}–${2 * seconds}s` }] : silent,
    silent: true, style: 'Cảnh B-roll do AI dựng để minh họa sản phẩm: nền gọn, ánh sáng mềm, sản phẩm giữ đúng hình dáng và chất liệu như ảnh nguồn', audio: 'Nhạc nền không lời nhẹ, không tiếng nói, không người dẫn', needsReview: true, evidence: [] });

  return {
    productName: title,
    style: 'Cảnh B-roll do AI dựng để minh họa sản phẩm: nền gọn, ánh sáng mềm, sản phẩm giữ đúng hình dáng và chất liệu như ảnh nguồn',
    facts: { name: title, price: price.price && !opts.noPrice ? displayVnd(price.price) : null, original: null, discount: 0,
      offers: offers.map(o => o.label), highlights: facts.map(x => compact(x)), season: '', audience: '', delivery: '', steps: [], pain: '', noPrice: !!opts.noPrice,
      sourceUrl: source, sellerProvided: true, warnings: warning, priceSource: price.source },
    rawLines: unique([...prices, ...policies]), images: imageList,
    scripts
  };
}
module.exports = { generateScriptsFromProduct, priceEvidence, sourceFacts, groundedOffers };
