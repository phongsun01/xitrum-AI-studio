/**
 * GOOGLE FLOW AI APP BUILDER ENGINE (flow-builder-ai.js)
 * Thực hiện quy trình tự động hóa 8 bước:
 *   Ý tưởng -> Kịch bản tổng thể & Khóa đồng nhất (Nhân vật, Sản phẩm, Bối cảnh)
 *   -> Chia danh sách Scene (Thời lượng, Nội dung, Hành động, Hình ảnh, Âm thanh)
 *   -> Sinh bộ Prompt Video chi tiết cho từng Scene chuẩn Google Flow (Veo 3.1 / Omni Flash).
 */

const GENRE_PROFILES = {
  commercial: {
    label: 'Quảng cáo sản phẩm (Commercial / TVC)',
    cameraStyle: 'chuyển động dolly và macro mượt mà chuẩn TVC thương mại cao cấp, lấy nét rack-focus chính xác vào sản phẩm',
    pacing: 'nhịp điệu cuốn hút, sang trọng, làm nổi bật chất liệu và giá trị sản phẩm',
    audioDefault: 'Nhạc nền thương mại hiện đại, tinh tế; âm thanh vật lý chân thực (SFX) khi chạm và sử dụng sản phẩm.'
  },
  fashion: {
    label: 'Thời trang & Lifestyle (Fashion / Lookbook)',
    cameraStyle: 'góc máy điện ảnh thời trang (editorial tracking shot, medium full shot & close-up), tôn dáng và chất liệu trang phục',
    pacing: 'chuyển động tự nhiên, thanh lịch, giàu cảm xúc lifestyle hiện đại',
    audioDefault: 'Nhạc nền lounge/indie thời trang hiện đại nhẹ nhàng, tiếng không gian quán tinh tế.'
  },
  ugc_review: {
    label: 'Review & Trải nghiệm thực tế (UGC / KOL)',
    cameraStyle: 'góc quay gần gũi, chân thực như máy ảnh mirrorless/điện thoại cao cấp, giữ lấy nét vào biểu cảm tự nhiên của nhân vật và sản phẩm trên tay',
    pacing: 'nhịp nhanh, gần gũi, tạo sự tin cậy cao ngay từ 3 giây đầu',
    audioDefault: 'Giọng nhân vật nói tự nhiên, rõ ràng, khẩu hình khớp lời; tiếng môi trường thật nhẹ phía sau.'
  },
  story: {
    label: 'Phim ngắn / Kể chuyện (Cinematic Story)',
    cameraStyle: 'ngữ pháp điện ảnh kinh điển (establishing wide shot, over-the-shoulder, emotional close-up), máy quay tĩnh hoặc push-in rất nhẹ',
    pacing: 'diễn xuất tiết chế, chiều sâu tâm lý, nối cảnh mượt theo trục 180 độ',
    audioDefault: 'Âm thanh hiện trường sống động, lời thoại đồng bộ khẩu hình, nhạc nền cảm xúc rất nhẹ.'
  },
  food: {
    label: 'Ẩm thực & Đời sống (Food Cinematic)',
    cameraStyle: 'góc macro đặc tả độ tươi ngon, làn khói, ánh sáng phản chiếu trên bề mặt món ăn kết hợp góc trung cảnh người thưởng thức',
    pacing: 'ấm cúng, kích thích vị giác, chuyển cảnh mềm mại',
    audioDefault: 'Tiếng chế biến/thưởng thức món ăn chân thực (ASMR nhẹ), nhạc acoustic ấm áp.'
  },
  brand: {
    label: 'Giới thiệu Thương hiệu / Giáo dục (Brand / Explainer)',
    cameraStyle: 'bố cục cân đối, chuyên nghiệp, góc máy rộng và trung cảnh sáng rõ, chuyển động gimbal mượt',
    pacing: 'mạch lạc, hiện đại, truyền cảm hứng và sự uy tín',
    audioDefault: 'Nhạc nền корпоратив/inspiring hiện đại, giọng thuyết minh ấm áp và rõ nét.'
  }
};

const VISUAL_STYLES = {
  luxury_cinematic: {
    label: 'Sang trọng, Cinematic (Luxury Cinematic 4K)',
    lighting: 'ánh sáng studio kết hợp golden hour sang trọng, rim light viền sáng tinh tế, độ tương phản điện ảnh mềm mại, bokeh lung linh',
    texture: 'Photorealistic 4K, ultra-detailed texture, shallow depth of field (f/1.8), ống kính cinema 50mm anamorphic, màu sắc sang trọng đồng nhất'
  },
  modern_lifestyle: {
    label: 'Hiện đại, Trẻ trung, Tươi sáng (Modern Lifestyle)',
    lighting: 'ánh sáng tự nhiên ban ngày dịu nhẹ tràn qua cửa kính lớn, tông màu trong trẻo, tươi tắn, da tự nhiên',
    texture: 'Photorealistic 4K, clean modern color grading, sắc nét tự nhiên, độ sâu trường ảnh vừa phải, không làm đẹp giả tạo'
  },
  natural_realistic: {
    label: 'Chân thực đời thường Việt Nam (Natural Realistic)',
    lighting: 'ánh sáng thực tế tự nhiên tại bối cảnh Việt Nam, màu ấm dịu, bóng đổ chân thật',
    texture: 'Realistic cinema 24fps, kết cấu da và chất liệu vải vóc/đồ vật chân thực 100%, không hiệu ứng ảo'
  },
  studio_commercial: {
    label: 'Studio Quảng cáo Cao cấp (High-end Studio)',
    lighting: 'hệ thống đèn studio 3 điểm chuyên nghiệp (key light, soft fill, backlight), phản xạ ánh sáng sắc sảo trên bề mặt sản phẩm',
    texture: 'Commercial product cinematography 8K, crisp focus, mặt phẳng phản chiếu tinh tế, màu sắc chuẩn xác tuyệt đối'
  },
  warm_film: {
    label: 'Điện ảnh Phim nhựa Ấm áp (Warm 35mm Film)',
    lighting: 'ánh nắng chiều ấm áp 3200K, bóng đổ mềm, không khí hoài niệm và giàu chất thơ',
    texture: '35mm Kodak Vision3 film look, subtle natural grain, rich warm tones, cinematic dynamic range'
  },
  minimal_editorial: {
    label: 'Tối giản Tinh tế (Minimalist Editorial)',
    lighting: 'ánh sáng khuếch tán mềm mại (soft diffused light), bảng màu trung tính бежевый/trắng/kem thanh lịch',
    texture: 'High-fashion editorial video, clean composition, kiến trúc tối giản, chi tiết sắc nét'
  }
};

/**
 * Tự động bóc tách Nhân vật, Sản phẩm và Bối cảnh từ câu ý tưởng tự nhiên của người dùng
 */
function analyzeIdeaEntities(ideaText = '', genre = 'commercial', visualStyle = 'luxury_cinematic') {
  const raw = String(ideaText || '').trim();
  const low = raw.toLowerCase();

  // 1. Nhận diện Nhân vật (Character)
  let character = '';
  if (/cô gái việt|phụ nữ việt|nữ việt/i.test(raw)) {
    character = 'Cô gái Việt Nam 24 tuổi, gương mặt thanh tú tự nhiên, làn da sáng khỏe, mái tóc đen dài suôn mượt, thần thái tự tin và cuốn hút, mặc trang phục thanh lịch màu trung tính nhạt (vải trơn hoàn toàn, không chữ, không logo)';
  } else if (/dành cho nữ|phái đẹp|nữ|cô gái|người mẫu nữ|chị em/i.test(raw)) {
    character = 'Người mẫu nữ châu Á / Việt Nam 24 tuổi, vẻ đẹp sang trọng thanh lịch, đường nét gương mặt hài hòa, tóc uốn sóng nhẹ tự nhiên, trang phục lụa/vải cao cấp màu kem nhạt tối giản (không chữ, không họa tiết rối)';
  } else if (/nam|chàng trai|đàn ông|quý ông|doanh nhân/i.test(raw)) {
    character = 'Chàng trai Việt Nam 27 tuổi, gương mặt điển trai lịch lãm, tóc cắt gọn gàng, mặc áo sơ mi/blazer tối giản phom dáng chuẩn (vải trơn, không chữ, không logo), phong thái tự tin chuyên nghiệp';
  } else if (/gia đình|mẹ|bố|con/i.test(raw)) {
    character = 'Gia đình Việt Nam hiện đại (người mẹ trẻ 28 tuổi dịu dàng mặc áo trơn màu pastel và người bố 30 tuổi ấm áp), biểu cảm tự nhiên, gần gũi và tràn đầy yêu thương';
  } else {
    character = 'Nhân vật chính người Việt Nam 25 tuổi, ngoại hình sáng, biểu cảm tự nhiên tinh tế, trang phục hiện đại tối giản màu trung tính (vải trơn hoàn toàn, không chữ hay logo)';
  }

  // 2. Nhận diện Sản phẩm / Chủ thể chính (Product / Subject)
  let product = '';
  if (/nước hoa/i.test(raw)) {
    product = 'Chai nước hoa nữ cao cấp thân thủy tinh pha lê trong suốt cắt giác tinh xảo, dung dịch nước hoa màu vàng hổ phách óng ánh bên trong, nắp kim loại mạ vàng ánh kim sang trọng, vòi xịt phun sương mịn';
  } else if (/thời trang|váy|đầm|áo|quần|túi xách|lookbook/i.test(raw)) {
    const subMatch = raw.match(/(?:sản phẩm\s+)?(thời trang[^,.]*|túi xách[^,.]*|bộ sưu tập[^,.]*|váy[^,.]*|áo[^,.]*)/i);
    const label = subMatch ? subMatch[1].trim() : 'sản phẩm thời trang thiết kế hiện đại';
    product = `Sản phẩm ${label}: thiết kế phom dáng chuẩn mực, đường may sắc sảo, chất liệu vải cao cấp mềm mại bắt sáng tự nhiên, kèm túi xách/phụ kiện đồng bộ tinh tế (giữ nguyên màu sắc và kiểu dáng ở mọi cảnh)`;
  } else if (/mỹ phẩm|serum|kem|son|skincare|dưỡng da/i.test(raw)) {
    product = 'Chai mỹ phẩm / serum dưỡng da cao cấp vỏ thủy tinh mờ sang trọng, ống nhỏ giọt tinh tế, kết cấu tinh chất trong suốt óng ánh (giữ nguyên hình dáng, màu sắc và tỷ lệ chai ở mọi cảnh)';
  } else if (/cà phê|trà|đồ uống|ly|cốc/i.test(raw) && !/quán cà phê/i.test(raw)) {
    product = 'Ly đồ uống / cà phê đặc sản pha chế nghệ thuật trong cốc thủy tinh trong suốt, lớp kem sữa mịn màng đẹp mắt';
  } else {
    // Trích cụm từ sau "quảng cáo", "giới thiệu", "về"
    const mProd = raw.match(/(?:quảng cáo|giới thiệu|review|làm video về)\s+(?:một\s+|các\s+)?([^,.]+?)(?:\s+trong|\s+tại|\s+dành cho|\s+phong cách|,|\.|$)/i);
    const extracted = mProd ? mProd[1].trim() : (raw.slice(0, 70) || 'sản phẩm cao cấp');
    product = `${extracted.charAt(0).toUpperCase() + extracted.slice(1)} — giữ nguyên 100% kiểu dáng, màu sắc, kích thước, chất liệu bề mặt và chi tiết thiết kế xuyên suốt mọi cảnh`;
  }

  // 3. Nhận diện Bối cảnh (Setting / Environment)
  let setting = '';
  if (/quán cà phê|cafe|coffee/i.test(raw)) {
    setting = 'Không gian quán cà phê hiện đại, sang trọng với khung cửa kính lớn đón ánh nắng tự nhiên, nội thất gỗ ấm kết hợp mặt bàn đá sáng, cây xanh trang trí tinh tế và ánh đèn vàng dịu';
  } else if (/nước hoa/i.test(low) && !/ngoài trời|biển|vườn/i.test(low)) {
    setting = 'Không gian bàn trang điểm / bục trưng bày đá cẩm thạch trắng vân mây trong căn phòng hạng sang, phía sau là rèm voan mỏng bay nhẹ đón nắng chiều vàng óng và ánh bokeh lung linh';
  } else if (/bếp|nấu ăn|gia đình/i.test(low)) {
    setting = 'Căn bếp hiện đại ấm cúng của gia đình Việt Nam, mặt bàn đá sạch sẽ, tủ gỗ sáng màu, ánh nắng ban ngày dịu nhẹ chiếu qua cửa sổ kết hợp đèn bếp ấm';
  } else if (/văn phòng|công sở|công ty/i.test(low)) {
    setting = 'Không gian văn phòng sáng tạo hiện đại, bàn làm việc tối giản, cửa kính lớn nhìn ra thành phố, ánh sáng tự nhiên trong trẻo';
  } else if (/ngoài trời|phố|công viên|biển|vườn/i.test(low)) {
    setting = 'Không gian ngoài trời thoáng đãng, ánh nắng golden hour dịu ngọt, hậu cảnh có chiều sâu xóa phông nhẹ nhàng (shallow depth of field)';
  } else {
    setting = 'Không gian studio / nội thất hiện đại được bài trí tinh tế, sạch sẽ, có chiều sâu không gian, ánh sáng hài hòa làm nổi bật chủ thể và sản phẩm';
  }

  const genreInfo = GENRE_PROFILES[genre] || GENRE_PROFILES.commercial;
  const styleInfo = VISUAL_STYLES[visualStyle] || VISUAL_STYLES.luxury_cinematic;

  return {
    idea: raw,
    characterLock: character,
    productLock: product,
    settingLock: setting,
    lightingLock: styleInfo.lighting,
    textureLock: styleInfo.texture,
    cameraLock: genreInfo.cameraStyle,
    audioLock: genreInfo.audioDefault
  };
}

/**
 * Khuôn mẫu kịch bản phân cảnh chuẩn theo mục #4 (linh hoạt từ 3 đến 8 cảnh, mặc định 5 cảnh vàng):
 *  - Scene 1: Quay cận cảnh sản phẩm / Thiết lập không gian
 *  - Scene 2: Nhân vật bước vào khung hình
 *  - Scene 3: Nhân vật sử dụng / tương tác với sản phẩm
 *  - Scene 4: Tiếp tục quay cận cảnh sản phẩm (chi tiết đắt giá)
 *  - Scene 5: Thực hiện cảnh kết thúc (ấn tượng thương hiệu)
 */
function buildSceneBlueprints(entities, { sceneCount = 5, sceneSecs = 8, genre = 'commercial', language = 'vi' } = {}) {
  const n = Math.min(Math.max(parseInt(sceneCount, 10) || 5, 1), 8);
  const secs = [4, 6, 8, 10].includes(Number(sceneSecs)) ? Number(sceneSecs) : 8;

  const isFashion = /thời trang|váy|đầm|áo|túi xách|quán cà phê/i.test(entities.idea);
  const isPerfume = /nước hoa/i.test(entities.idea);

  const templates5 = [
    {
      role: 'Quay cận cảnh sản phẩm (Macro Establishing Shot)',
      content: `Mở đầu bằng khung hình cận cảnh đặc tả vẻ đẹp và chất liệu cao cấp của sản phẩm đặt trong bối cảnh chính, thu hút thị giác ngay từ giây đầu tiên.`,
      action: isPerfume
        ? `Chai nước hoa đặt nổi bật trên mặt bàn, ánh nắng vàng chiếu xuyên qua lớp thủy tinh pha lê tạo hiệu ứng khúc xạ lấp lánh. Không gian tĩnh lặng và sang trọng.`
        : isFashion
          ? `Đặc tả cận cảnh chất liệu vải vóc, đường kim mũi chỉ tinh xảo và phụ kiện thời trang đặt/khoác thanh lịch trong không gian quán cà phê ngập nắng.`
          : `Sản phẩm xuất hiện sắc nét ở trung tâm khung hình, ánh sáng lướt nhẹ trên bề mặt làm nổi bật từng đường nét thiết kế và chất liệu cao cấp.`,
      visual: `Góc cận cảnh (Macro / Extreme Close-up), máy quay trượt dolly-in thật chậm và mượt, hậu cảnh xóa phông bokeh lung linh.`,
      cameraAngle: 'Macro Close-up (Cận cảnh đặc tả)',
      cameraMotion: 'Slow Dolly-In (Đẩy máy vào chậm mượt)',
      audio: `Tiếng nhạc nền mở đầu sang trọng tinh tế, âm thanh không gian dịu nhẹ.`
    },
    {
      role: 'Nhân vật bước vào khung hình (Character Entrance)',
      content: `Nhân vật chính xuất hiện trong khung hình với thần thái cuốn hút, kết nối tự nhiên với không gian và hướng sự chú ý về phía sản phẩm.`,
      action: isFashion
        ? `Nhân vật bước nhẹ nhàng vào không gian quán cà phê hiện đại, dừng lại bên bàn cạnh khung cửa kính, mỉm cười tự nhiên và chỉnh nhẹ trang phục đầy thanh lịch.`
        : `Nhân vật bước chậm rãi vào khung hình, ánh mắt thu hút nhìn về phía sản phẩm trên bàn, bàn tay thon dài nhẹ nhàng chạm và nâng sản phẩm lên.`,
      visual: `Góc trung cảnh (Medium Shot) ngang tầm mắt, máy quay pan nhẹ theo bước chân nhân vật, ánh sáng viền (rim light) tôn lên đường nét gương mặt và trang phục.`,
      cameraAngle: 'Medium Shot (Trung cảnh ngang tầm mắt)',
      cameraMotion: 'Smooth Pan & Track (Lia máy nhẹ theo chuyển động)',
      audio: `Tiếng bước chân nhẹ nhàng tinh tế, nhạc nền dâng nhẹ tạo cảm xúc cuốn hút.`
    },
    {
      role: 'Nhân vật sử dụng / giới thiệu sản phẩm (Hero Interaction)',
      content: `Cao trào trải nghiệm: nhân vật trực tiếp sử dụng hoặc giới thiệu sản phẩm trên tay, thể hiện sự hài lòng và khí chất nổi bật.`,
      action: isPerfume
        ? `Nhân vật nâng chai nước hoa lên ngang cổ tay, nhẹ nhàng nhấn vòi xịt tạo làn sương mịn lấp lánh dưới nắng, khẽ nhắm mắt tận hưởng hương thơm quyến rũ với biểu cảm mãn nguyện.`
        : isFashion
          ? `Nhân vật xoay nhẹ người giới thiệu phom dáng trang phục và phụ kiện thời trang, tay lướt nhẹ trên chất vải mềm mại, gương mặt rạng rỡ tự tin trò chuyện tự nhiên trước ống kính.`
          : `Nhân vật thao tác sử dụng sản phẩm một cách tự nhiên, thuần thục; gương mặt ánh lên nụ cười hài lòng khi cảm nhận chất lượng vượt trội của sản phẩm.`,
      visual: `Góc trung cận (Medium Close-up), lấy nét sắc sảo vào cả gương mặt nhân vật và sản phẩm trên tay, chuyển động máy ổn định (gimbal stabilizer).`,
      cameraAngle: 'Medium Close-up (Trung cận nhân vật & sản phẩm)',
      cameraMotion: 'Subtle Push-In (Đẩy nhẹ vào biểu cảm & thao tác)',
      audio: isPerfume
        ? `Tiếng xịt nước hoa phun sương thanh mảnh rõ nét, hòa cùng giai điệu nhạc nền cinematic quyến rũ.`
        : `Âm thanh tương tác sản phẩm chân thực, giọng/nhạc nền ấm áp, truyền cảm hứng.`
    },
    {
      role: 'Tiếp tục quay cận sản phẩm (Sensory Detail Highlight)',
      content: `Cú máy đặc tả chi tiết đắt giá thứ hai của sản phẩm sau khi tương tác, khắc sâu hình ảnh sản phẩm vào tâm trí người xem.`,
      action: isPerfume
        ? `Quay cận cảnh những hạt sương nước hoa siêu mịn bay lơ lửng trong nắng vàng quanh thân chai pha lê và cổ tay nhân vật, ánh sáng phản chiếu lấp lánh.`
        : isFashion
          ? `Góc máy cận cảnh đi dọc theo đường cắt may tinh tế, cúc áo/khóa kim loại sáng bóng và độ rủ mềm mại của trang phục khi nhân vật di chuyển nhẹ trong nắng chiều.`
          : `Cận cảnh bàn tay nhân vật đặt sản phẩm xuống mặt bàn, ánh sáng chiếu nổi khối làm bật lên độ hoàn thiện tỉ mỉ của sản phẩm từ góc nhìn nghiêng 45 độ.`,
      visual: `Góc cận cảnh nghệ thuật (Detail Close-up 45°), kỹ thuật chuyển nét (Rack Focus) từ hậu cảnh vào thẳng bề mặt sản phẩm, độ nét 4K hoàn hảo.`,
      cameraAngle: 'Detail Close-up 45° (Cận cảnh chi tiết góc nghiêng)',
      cameraMotion: 'Slow Orbit / Rack Focus (Xoay nhẹ & chuyển nét)',
      audio: `Hiệu ứng âm thanh tinh tế làm điểm nhấn (shimmer/chime nhẹ), nhạc nền giữ nhịp sang trọng.`
    },
    {
      role: 'Thực hiện cảnh kết thúc (Signature Ending & CTA)',
      content: `Cảnh kết lắng đọng: kết hợp hài hòa giữa nhân vật rạng rỡ và sản phẩm ở vị trí trung tâm, tạo dấu ấn thương hiệu hoàn hảo.`,
      action: `Nhân vật đứng/ngồi thanh lịch bên cạnh sản phẩm được đặt trang trọng ở tiền cảnh, nhìn thẳng vào ống kính với nụ cười tự tin và ánh mắt cuốn hút, khung hình dừng lại đầy chất điện ảnh.`,
      visual: `Góc trung cảnh cân đối (Hero Composition), sản phẩm sắc nét ở tiền cảnh kết hợp nhân vật ở trung cảnh, ánh sáng vàng ấm bao phủ toàn bộ khung hình.`,
      cameraAngle: 'Hero Composition Shot (Bố cục kết phim cân đối)',
      cameraMotion: 'Steady Hold / Slow Pull-Back (Giữ tĩnh hoặc lùi nhẹ kết cảnh)',
      audio: `Nhạc nền kết thúc bằng hợp âm ngân vang sang trọng, để lại dư âm sâu sắc.`
    }
  ];

  // Điều chỉnh danh sách cảnh theo đúng sceneCount người dùng chọn
  let selected = [];
  if (n === 1) {
    selected = [templates5[2]];
  } else if (n === 2) {
    selected = [templates5[0], templates5[4]];
  } else if (n === 3) {
    selected = [templates5[0], templates5[2], templates5[4]];
  } else if (n === 4) {
    selected = [templates5[0], templates5[1], templates5[2], templates5[4]];
  } else if (n === 5) {
    selected = templates5;
  } else {
    selected = [...templates5];
    const extras = [
      {
        role: 'Góc nhìn toàn cảnh không gian & Phong cách sống (Wide Lifestyle Shot)',
        content: 'Mở rộng không gian để thấy sự giao thoa hoàn hảo giữa nhân vật, sản phẩm và kiến trúc xung quanh.',
        action: 'Nhân vật di chuyển tự nhiên trong không gian rộng, mang theo sản phẩm như một phần không thể thiếu của phong cách sống hiện đại.',
        visual: 'Góc toàn cảnh (Wide Shot), máy quay trượt ngang (trucking shot) tạo chiều sâu điện ảnh.',
        cameraAngle: 'Wide Cinematic Shot (Toàn cảnh điện ảnh)',
        cameraMotion: 'Lateral Tracking Shot (Trượt ngang mượt mà)',
        audio: 'Nhạc nền tiếp nối liền mạch, âm thanh môi trường chân thực.'
      },
      {
        role: 'Cận cảnh biểu cảm cảm xúc của nhân vật (Emotional Close-up)',
        content: 'Đặc tả ánh mắt và nụ cười hài lòng của nhân vật khi trải nghiệm sản phẩm.',
        action: 'Nhân vật khẽ nghiêng đầu, ánh nắng chiếu nhẹ qua mái tóc, biểu cảm gương mặt toát lên sự tự tin và niềm vui tinh tế.',
        visual: 'Góc cận gương mặt (Portrait Close-up), ống kính 85mm xóa phông mịn màng.',
        cameraAngle: 'Portrait Close-up (Cận cảnh chân dung)',
        cameraMotion: 'Static / Micro Push-In (Máy tĩnh giữ nhịp cảm xúc)',
        audio: 'Giai điệu nhạc nền sâu lắng, tôn lên cảm xúc nhân vật.'
      },
      {
        role: 'Góc nhìn nghệ thuật từ trên cao (Top-Down Flatlay Shot)',
        content: 'Bố cục sắp đặt nghệ thuật sản phẩm cùng các đạo cụ tinh tế trên mặt bàn.',
        action: 'Bàn tay nhân vật nhẹ nhàng đặt sản phẩm vào đúng vị trí trung tâm của bố cục ánh sáng trên mặt bàn.',
        visual: 'Góc chụp thẳng từ trên xuống (Top-Down Overhead Shot), ánh sáng tạo bóng đổ nghệ thuật.',
        cameraAngle: 'Top-Down Overhead (Góc nhìn từ trên cao)',
        cameraMotion: 'Slow Crane Down (Hạ máy nhẹ từ trên xuống)',
        audio: 'Tiếng đặt sản phẩm nhẹ nhàng, nhạc nền trong trẻo.'
      }
    ];
    while (selected.length < n) {
      // Chèn cảnh bổ sung vào trước cảnh kết thúc
      const extra = extras[(selected.length - 5) % extras.length];
      selected.splice(selected.length - 1, 0, { ...extra });
    }
  }

  return selected.map((tpl, idx) => {
    const sceneNum = idx + 1;
    const startSec = idx * secs;
    const endSec = (idx + 1) * secs;
    const scene = {
      id: `scene_${sceneNum}_${Date.now().toString(36)}`,
      index: sceneNum,
      sceneNum,
      totalScenes: n,
      durationSec: secs,
      timeRange: `${startSec}s-${endSec}s`,
      title: `Scene ${sceneNum}: ${tpl.role}`,
      role: tpl.role,
      content: tpl.content,
      action: tpl.action,
      visual: tpl.visual,
      camera: `${tpl.cameraAngle} — ${tpl.cameraMotion}. ${tpl.visual}`,
      cameraAngle: tpl.cameraAngle,
      cameraMotion: tpl.cameraMotion,
      audio: tpl.audio,
      hasCharacter: idx !== 0 && idx !== 3 || n <= 2,
      prompt: ''
    };
    scene.prompt = buildScenePrompt(scene, entities, { ratio: '9:16', language, totalScenes: n });
    return scene;
  });
}

/**
 * Bước #5: Tạo Prompt Video đầy đủ cho từng Scene
 * Gồm: Nhân vật + Sản phẩm + Hành động + Bối cảnh + Góc máy + Chuyển động camera + Ánh sáng + Chất liệu hình ảnh + Phong cách cinematic + Âm thanh + Khóa nhất quán.
 */
function buildScenePrompt(scene = {}, entities = {}, opts = {}) {
  const ratio = opts.ratio || opts.aspectRatio || '9:16';
  const visualStyle = opts.visualStyle || opts.style || 'luxury_cinematic';
  const language = opts.language || 'vi';
  const totalScenes = opts.totalScenes || scene.totalScenes || 5;
  const sceneNum = scene.index || scene.sceneNum || 1;
  const secs = scene.durationSec || 8;
  const styleInfo = VISUAL_STYLES[visualStyle] || VISUAL_STYLES.luxury_cinematic;
  const lightingText = entities.lightingLock || entities.lighting || styleInfo.lighting;
  const textureText = entities.textureLock || styleInfo.texture;
  const cameraText = scene.camera || `${scene.cameraAngle || 'Cinematic Shot'} — ${scene.cameraMotion || 'Smooth Dolly'}. ${scene.visual || ''}`;

  const ratioDesc = ratio === '16:9'
    ? '16:9 khung hình ngang (wide landscape composition)'
    : ratio === '1:1'
      ? '1:1 khung hình vuông (square composition)'
      : '9:16 khung hình dọc (tall vertical portrait composition)';

  if (language === 'en') {
    return [
      `Create a ${ratio} aspect ratio cinematic video clip, ${secs} seconds long, 24fps, photorealistic 4K quality. Scene ${sceneNum}/${totalScenes} (${scene.timeRange || `0-${secs}s`}) — ${scene.role || scene.title || `Scene ${sceneNum}`}.`,
      `[PRODUCT & PROP CONSISTENCY LOCK]: ${entities.productLock || ''}. Keep the exact same product shape, color, material, and proportions across all scenes.`,
      `[CHARACTER CONSISTENCY LOCK]: ${entities.characterLock || ''}. Preserve exact facial identity, age, hairstyle, and outfit across every scene.`,
      `[ENVIRONMENT & SETTING]: ${entities.settingLock || ''}.`,
      `[SCENE ACTION]: ${scene.action || scene.content || ''}`,
      `[CAMERA & MOVEMENT]: ${cameraText}`,
      `[LIGHTING & TEXTURE]: ${lightingText}. ${textureText}.`,
      `[AUDIO & SOUND DESIGN]: ${scene.audio || entities.audioLock || 'Cinematic ambient audio'}`,
      `[STRICT QUALITY GUARD]: Natural human anatomy with five fingers per hand, smooth continuous motion, strictly plain clothes with zero text/logos, no on-screen subtitles, no watermarks, no morphing.`
    ].join('\n');
  }

  return [
    `Tạo video điện ảnh tỉ lệ ${ratioDesc}, thời lượng ${secs} giây, 24fps, chất lượng Photorealistic 4K. [Scene ${sceneNum}/${totalScenes} (${scene.timeRange || `0-${secs}s`}) — ${scene.role || scene.title || `Scene ${sceneNum}`}].`,
    `• KHÓA ĐỒNG NHẤT SẢN PHẨM: ${entities.productLock || ''}.`,
    `• KHÓA ĐỒNG NHẤT NHÂN VẬT: ${entities.characterLock || ''}.`,
    `• BỐI CẢNH: ${entities.settingLock || ''}.`,
    `• NỘI DUNG & HÀNH ĐỘNG: ${scene.content ? `${scene.content} ` : ''}${scene.action || ''}`,
    `• GÓC MÁY & CHUYỂN ĐỘNG CAMERA: ${cameraText}`,
    `• ÁNH SÁNG & CHẤT LIỆU HÌNH ẢNH: ${lightingText}. ${textureText}.`,
    `• ÂM THANH: ${scene.audio || entities.audioLock || 'Nhạc nền điện ảnh sang trọng, âm thanh tự nhiên chân thực.'}`,
    `• YÊU CẦU CHẤT LƯỢNG (Consistency & Negative Guard): Giữ nguyên 100% diện mạo nhân vật, trang phục và thiết kế sản phẩm xuyên suốt mọi scene; bàn tay tự nhiên đủ 5 ngón; chuyển động mượt mà đúng một cảnh liên tục; trang phục trơn tuyệt đối không có chữ rác, không chèn phụ đề, không logo, không watermark.`
  ].join('\n');
}

/**
 * Hàm tổng hợp: Từ Ý tưởng + Tùy chọn -> Sinh trọn bộ Kịch bản + Danh sách Scene + Bộ Prompt hoàn chỉnh
 */
function generateFlowProjectFromIdea(input = {}) {
  const nested = input.options || {};
  const idea = input.idea || 'Tạo video quảng cáo một chai nước hoa dành cho nữ, phong cách sang trọng, cinematic.';
  const genre = nested.genre || input.genre || 'commercial';
  const visualStyle = nested.style || nested.visualStyle || input.visualStyle || input.style || 'luxury_cinematic';
  const durationSec = nested.durationSec || input.durationSec || 40;
  const sceneCount = nested.sceneCount || input.sceneCount || 5;
  const ratio = nested.aspectRatio || nested.ratio || input.ratio || input.aspectRatio || '9:16';
  const language = nested.language || input.language || 'vi';
  const customCharacterLock = nested.characterDesc || input.customCharacterLock || '';
  const customProductLock = input.customProductLock || '';
  const customSettingLock = input.customSettingLock || '';

  const n = Math.min(Math.max(parseInt(sceneCount, 10) || 5, 1), 8);
  const rawTotal = parseInt(durationSec, 10) || (n * 8);
  const perScene = Math.round(rawTotal / n);
  const sceneSecs = perScene >= 9 ? 10 : perScene <= 5 ? 6 : 8;

  const entities = analyzeIdeaEntities(idea, genre, visualStyle);
  if (customCharacterLock && customCharacterLock.trim()) {
    entities.characterLock = `${customCharacterLock.trim()} — ${entities.characterLock}`;
  }
  if (customProductLock && customProductLock.trim()) entities.productLock = customProductLock.trim();
  if (customSettingLock && customSettingLock.trim()) entities.settingLock = customSettingLock.trim();

  const scenes = buildSceneBlueprints(entities, {
    sceneCount: n,
    sceneSecs,
    genre,
    language
  }).map((sc, idx) => ({
    ...sc,
    index: idx + 1,
    sceneNum: idx + 1,
    prompt: buildScenePrompt(sc, entities, { ratio, visualStyle, language, totalScenes: n })
  }));

  const genreLabel = (GENRE_PROFILES[genre] || GENRE_PROFILES.commercial).label;
  const styleLabel = (VISUAL_STYLES[visualStyle] || VISUAL_STYLES.luxury_cinematic).label;

  const scriptOverview = [
    `KỊCH BẢN TỔNG THỂ (${n} Scene × ${sceneSecs}s = ${n * sceneSecs}s | Tỷ lệ ${ratio} | ${genreLabel})`,
    `• Ý tưởng gốc: ${idea}`,
    `• Phong cách chủ đạo: ${styleLabel}`,
    `• Khóa Nhân vật xuyên suốt: ${entities.characterLock}`,
    `• Khóa Sản phẩm xuyên suốt: ${entities.productLock}`,
    `• Khóa Bối cảnh xuyên suốt: ${entities.settingLock}`,
    ``,
    `TÓM TẮT DÒNG CHẢY PHÂN CẢNH:`,
    ...scenes.map(s => `- ${s.title} (${s.timeRange}): ${s.action}`)
  ].join('\n');

  return {
    idea,
    genre,
    visualStyle,
    ratio,
    language,
    sceneCount: n,
    sceneSecs,
    totalDurationSec: n * sceneSecs,
    entities,
    scriptOverview,
    scenes
  };
}

/**
 * Tạo Master Prompt để người dùng có thể copy sang ChatGPT (tiết kiệm credit) rồi dán ngược kết quả về App
 */
function buildChatGptHelperPrompt(input = {}) {
  const nested = input.options || {};
  const idea = input.idea || '';
  const genre = nested.genre || input.genre || 'commercial';
  const visualStyle = nested.style || nested.visualStyle || input.visualStyle || 'luxury_cinematic';
  const sceneCount = nested.sceneCount || input.sceneCount || 5;
  const durationSec = nested.durationSec || input.durationSec || (sceneCount * 8);
  const sceneSecs = Math.max(5, Math.round(durationSec / Math.max(1, sceneCount)));
  const ratio = nested.aspectRatio || nested.ratio || input.ratio || '9:16';

  const genreLabel = (GENRE_PROFILES[genre] || GENRE_PROFILES.commercial).label;
  const styleLabel = (VISUAL_STYLES[visualStyle] || VISUAL_STYLES.luxury_cinematic).label;

  return `Bạn là Đạo diễn AI Video chuyên nghiệp cho Google Flow (Veo 3.1).
Hãy phát triển ý tưởng sau thành kịch bản và bộ prompt chi tiết gồm ${sceneCount} Scene (mỗi Scene ${sceneSecs} giây, tỷ lệ ${ratio}):
- Ý tưởng: "${idea}"
- Thể loại: ${genreLabel}
- Phong cách hình ảnh: ${styleLabel}

Hãy trả lời bằng JSON hợp lệ (hoặc danh sách SCENE 1..${sceneCount}) theo cấu trúc sau để tôi dán thẳng vào phần mềm Sesame Studio:
{
  "productLock": "Mô tả cố định sản phẩm xuyên suốt mọi cảnh",
  "characterLock": "Mô tả cố định nhân vật (tuổi, gương mặt, kiểu tóc, trang phục trơn không chữ)",
  "settingLock": "Mô tả cố định bối cảnh và ánh sáng",
  "scenes": [
    {
      "index": 1,
      "title": "Scene 1: Quay cận cảnh sản phẩm",
      "durationSec": ${sceneSecs},
      "content": "Mô tả nội dung cảnh",
      "action": "Mô tả hành động",
      "camera": "Góc máy và chuyển động camera",
      "audio": "Mô tả âm thanh / nhạc nền",
      "prompt": "Prompt đầy đủ gồm nhân vật, sản phẩm, hành động, bối cảnh, góc máy, chuyển động camera, ánh sáng, chất liệu 4K, phong cách cinematic và âm thanh"
    }
  ]
}`;
}

/**
 * Phân tích kịch bản/prompt người dùng soạn sẵn từ ChatGPT dán vào App
 * Hỗ trợ cả JSON (`{"scenes": [...]}`) lẫn văn bản "SCENE 1 / Scene 1 / Cảnh 1"
 */
function parseExternalScriptToScenes(rawText = '', currentEntitiesOrPayload = {}, opts = {}) {
  if (typeof rawText === 'object' && rawText !== null) {
    opts = rawText.options || rawText.opts || opts;
    currentEntitiesOrPayload = rawText.entities || rawText;
    rawText = rawText.rawText || '';
  }
  const text = String(rawText || '').trim();
  const idea = currentEntitiesOrPayload?.idea || opts?.idea || '';
  const nestedOpts = currentEntitiesOrPayload?.options || opts?.options || opts || {};
  const ratio = nestedOpts.aspectRatio || nestedOpts.ratio || '9:16';
  const visualStyle = nestedOpts.style || nestedOpts.visualStyle || 'luxury_cinematic';
  const language = nestedOpts.language || 'vi';
  const defaultSecs = nestedOpts.sceneSecs || 8;

  const baseEntities = analyzeIdeaEntities(idea, nestedOpts.genre || 'commercial', visualStyle);
  if (currentEntitiesOrPayload?.productLock) baseEntities.productLock = currentEntitiesOrPayload.productLock;
  if (currentEntitiesOrPayload?.characterLock) baseEntities.characterLock = currentEntitiesOrPayload.characterLock;
  if (currentEntitiesOrPayload?.settingLock) baseEntities.settingLock = currentEntitiesOrPayload.settingLock;

  if (!text) {
    return { entities: baseEntities, scriptOverview: '', scenes: [] };
  }

  // 1. Thử parse JSON nếu kết quả từ ChatGPT là JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsedObj = JSON.parse(jsonMatch[0]);
      if (parsedObj && Array.isArray(parsedObj.scenes) && parsedObj.scenes.length > 0) {
        if (parsedObj.productLock) baseEntities.productLock = parsedObj.productLock;
        if (parsedObj.characterLock) baseEntities.characterLock = parsedObj.characterLock;
        if (parsedObj.settingLock) baseEntities.settingLock = parsedObj.settingLock;
        const total = parsedObj.scenes.length;
        const scenes = parsedObj.scenes.map((item, idx) => {
          const sceneNum = idx + 1;
          const dur = Number(item.durationSec) || defaultSecs;
          const sc = {
            id: `scene_${sceneNum}_${Date.now().toString(36)}_${idx}`,
            index: sceneNum,
            sceneNum,
            totalScenes: total,
            durationSec: dur,
            timeRange: `${idx * dur}s-${(idx + 1) * dur}s`,
            title: item.title || `Scene ${sceneNum}`,
            role: item.role || item.title || `Scene ${sceneNum}`,
            content: item.content || item.action || '',
            action: item.action || item.content || '',
            visual: item.camera || item.visual || 'Góc máy điện ảnh 4K, chuyển động mượt.',
            camera: item.camera || item.visual || 'Cinematic Shot — Smooth Camera Motion',
            cameraAngle: item.cameraAngle || 'Cinematic Shot',
            cameraMotion: item.cameraMotion || 'Smooth Motion',
            audio: item.audio || baseEntities.audioLock,
            hasCharacter: true,
            prompt: ''
          };
          sc.prompt = item.prompt && String(item.prompt).trim().length > 15
            ? String(item.prompt).trim()
            : buildScenePrompt(sc, baseEntities, { ratio, visualStyle, language, totalScenes: total });
          return sc;
        });
        const scriptOverview = scenes.map(s => `- ${s.title} (${s.timeRange}): ${s.action}`).join('\n');
        return { entities: baseEntities, scriptOverview, scenes };
      }
    } catch (_) {}
  }

  // 2. Fallback: Tách theo tiêu đề Scene X / Cảnh X dạng văn bản
  const blocks = text
    .split(/\n(?=\s*(?:#+\s*)?(?:SCENE|Scene|CẢNH|Cảnh)\s+\d+\b)/)
    .map(b => b.trim())
    .filter(Boolean);

  const sceneHeaderRe = /^(?:#+\s*)?(?:SCENE|Scene|CẢNH|Cảnh)\s+(\d+)\s*(?:\(([^)]*)\))?\s*[:\-–—]?\s*(.*)$/im;
  const matchedBlocks = blocks.filter(b => sceneHeaderRe.test(b));

  const targetBlocks = matchedBlocks.length > 0
    ? matchedBlocks
    : text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);

  const total = targetBlocks.length;
  const scenes = targetBlocks.map((block, idx) => {
    const sceneNum = idx + 1;
    const hm = sceneHeaderRe.exec(block);
    const roleTitle = hm && hm[3] ? hm[3].trim() : `Phân cảnh ${sceneNum}`;
    const timeMeta = hm && hm[2] ? hm[2].trim() : '';
    const secMatch = timeMeta.match(/(\d+)\s*s/i);
    const secs = secMatch ? parseInt(secMatch[1], 10) : defaultSecs;

    const extractField = (regex) => {
      const m = block.match(regex);
      return m ? m[1].trim() : '';
    };

    const content = extractField(/(?:Nội dung|Content|Mô tả)\s*:\s*([^\n]+)/i);
    const action = extractField(/(?:Hành động|Action|Diễn biến)\s*:\s*([^\n]+)/i);
    const visual = extractField(/(?:Hình ảnh(?:\s*&\s*Camera)?|Visual|Camera|Góc máy)\s*:\s*([^\n]+)/i);
    const audio = extractField(/(?:Âm thanh|Audio|Thoại|Voiceover)\s*:\s*([^\n]+)/i);
    const explicitPrompt = extractField(/(?:Prompt(?:\s*video)?)\s*:\s*([\s\S]+?)(?=\n\s*[-•]*(?:Nội dung|Hành động|Hình ảnh|Âm thanh|$)|$)/i);

    const cleanedBody = block.replace(sceneHeaderRe, '').trim();
    const dur = [4, 6, 8, 10].includes(secs) ? secs : defaultSecs;
    const sc = {
      id: `scene_${sceneNum}_${Date.now().toString(36)}_${idx}`,
      index: sceneNum,
      sceneNum,
      totalScenes: total,
      durationSec: dur,
      timeRange: `${idx * dur}s-${(idx + 1) * dur}s`,
      title: `Scene ${sceneNum}: ${roleTitle}`,
      role: roleTitle,
      content: content || cleanedBody.slice(0, 180) || roleTitle,
      action: action || cleanedBody || roleTitle,
      visual: visual || 'Góc máy điện ảnh 4K sắc nét, chuyển động mượt mà.',
      camera: visual || 'Cinematic Shot — Smooth Camera Motion',
      cameraAngle: 'Cinematic Shot',
      cameraMotion: 'Smooth Camera Motion',
      audio: audio || baseEntities.audioLock || 'Nhạc nền điện ảnh và âm thanh tự nhiên.',
      hasCharacter: true,
      prompt: ''
    };

    sc.prompt = explicitPrompt
      ? explicitPrompt.trim()
      : buildScenePrompt(sc, baseEntities, { ratio, visualStyle, language, totalScenes: total });

    return sc;
  });

  const scriptOverview = scenes.map(s => `- ${s.title} (${s.timeRange}): ${s.action}`).join('\n');
  return { entities: baseEntities, scriptOverview, scenes };
}

module.exports = {
  GENRE_PROFILES,
  VISUAL_STYLES,
  analyzeIdeaEntities,
  buildSceneBlueprints,
  buildScenePrompt,
  generateFlowProjectFromIdea,
  buildChatGptHelperPrompt,
  parseExternalScriptToScenes
};


