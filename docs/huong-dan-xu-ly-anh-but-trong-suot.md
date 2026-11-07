# Hướng Dẫn Xử Lý Tách Nền Trong Suốt Cho Asset Bút (Whiteboard Pen Assets)

Tài liệu này ghi lại quy trình kỹ thuật và script tự động để tách nền trong suốt (`RGBA`) cho các ảnh asset bút vẽ trong `sidecar-whiteboard/assets/`, đảm bảo:
1. **Nền trắng bên ngoài trong suốt hoàn toàn** (`Alpha = 0`).
2. **Khử viền trắng (De-fringing) và viền mềm mịn (Anti-aliasing)** khi bút di chuyển trên mọi nền (sáng, tối, màu sắc).
3. **Tuyệt đối không làm mất hoặc thủng chữ, hoa văn, khắc chìm trên thân bút** (các nét chữ màu đen/nâu hoặc chi tiết ngọc/kim loại bên trong thân bút).
4. **Xử lý chuẩn xác các khe hở cơ học** (khe giữa kẹp cài bút `clip` và thân bút, móc xỏ dây treo bút).

---

## 1. Bản chất vấn đề khi tách nền bút vẽ

- **Thân bút có chữ khắc chìm hoặc hoa văn tối màu**: Nếu dùng công cụ xóa màu đơn giản (color keying) hoặc ngưỡng độ sáng naive, các chữ đen/nét vẽ trên thân bút sẽ bị nhận diện nhầm là viền hoặc nền tối và bị đục thủng lỗ.
- **Bút có các khoảng hở vật lý**: Kẹp cài áo (`clip`) trên bút máy/bút kỹ thuật hoặc lỗ xỏ dây tạo ra các vùng nền trắng nằm lọt thỏm giữa thân bút và thanh kẹp. Nếu chỉ flood-fill từ góc ngoài thì khe này vẫn giữ nguyên mảng trắng đục.
- **Viền răng cưa và viền trắng lem (White Halo / Fringe)**: Khi render trên nền trắng, các pixel ở mép bút bị hòa trộn quang học với màu trắng (Anti-aliasing gốc). Nếu chỉ cắt theo mặt nạ nhị phân cứng, mép bút sẽ bị viền trắng sáng xấu khi đặt trên nền vẽ màu tối.

---

## 2. Quy trình xử lý 4 bước

```
                     [Ảnh gốc RGB / RGBA nền trắng]
                                  │
                                  ▼
      Bước 1: Phân đoạn vùng nền tiếp xúc biên (Connected Components)
             - Nhận diện các cụm pixel trắng (RGB >= 240) chạm 4 cạnh ảnh
             - Nhận diện thêm khe hở kẹp bút (clip holes)
                                  │
                                  ▼
      Bước 2: Xây dựng mặt nạ thân bút (Pen Silhouette Mask)
             - Thân bút = Vùng đảo ngược của toàn bộ nền
             - Toàn bộ chữ & hoa văn bên trong được bảo vệ 100%
                                  │
                                  ▼
      Bước 3: Tạo viền mờ mềm SDF (Signed Distance Field)
             - sdf = dist_inside - dist_outside
             - Gradient Alpha mượt trong dải [-1.2px, +1.2px]
             - Phần ruột bút (sdf > 1.2): Alpha = 255 cố định
             - Phần nền (sdf < -1.2): Alpha = 0
                                  │
                                  ▼
      Bước 4: Bóc tách màu nền trắng ở viền (De-fringing)
             - Phục hồi màu foreground thật: F = (C - (1 - a) * 255) / a
             - Xuất file định dạng PNG chuẩn RGBA
```

---

## 3. Script Python tự động hóa

Script xử lý nằm sẵn trong môi trường ảo của sidecar (`sidecar-whiteboard/.venv`). Bạn có thể chạy trực tiếp bằng lệnh terminal:

```bash
/Users/xitrum/Documents/Dev/REA/xitrum-AI-studio/sidecar-whiteboard/.venv/bin/python - << 'EOF'
import os
import cv2
import numpy as np

def make_pen_background_transparent(img_path: str):
    """
    Tách nền trong suốt cho ảnh bút:
    - Loại bỏ nền trắng ngoại vi & khe hở kẹp cài.
    - Khử viền trắng (de-fringe) + làm mượt viền (anti-aliasing).
    - Bảo toàn 100% chữ và chi tiết bên trong thân bút.
    """
    img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        print(f"Error: Không thể đọc file {img_path}")
        return

    # Lấy 3 kênh màu BGR
    bgr = img[:, :, :3] if img.shape[2] == 4 else img
    h, w = bgr.shape[:2]

    # 1. Phát hiện các vùng trắng (RGB >= 240)
    is_white = np.all(bgr >= 240, axis=-1).astype(np.uint8)
    num, lab, stats, _ = cv2.connectedComponentsWithStats(is_white)

    # Mặt nạ 4 đường biên ảnh
    border_mask = np.zeros((h, w), dtype=bool)
    border_mask[0, :] = True
    border_mask[-1, :] = True
    border_mask[:, 0] = True
    border_mask[:, -1] = True

    # Gom các nhãn trắng tiếp xúc với cạnh ảnh
    border_lbls = set(np.unique(lab[border_mask]))
    if 0 in border_lbls:
        border_lbls.remove(0)

    # Gom các khe hở kẹp bút (clip holes) ở góc trên bên phải
    clip_holes = []
    for lbl in range(1, num):
        if lbl not in border_lbls:
            area = stats[lbl, 4]
            x, y, bw, bh = stats[lbl, :4]
            # Khe hở kẹp bút thường có diện tích > 1000px, nằm trong vùng y=1000..1500, x=1100..1700
            if area > 1000 and 1000 < y < 1500 and 1100 < x < 1700:
                clip_holes.append(lbl)

    bg_labels = border_lbls.union(clip_holes)
    bg_mask = np.isin(lab, list(bg_labels))
    pen_mask = (~bg_mask).astype(np.uint8)

    # 2. Tạo viền mượt Signed Distance Field (SDF)
    dist_inside = cv2.distanceTransform(pen_mask, cv2.DIST_L2, 5)
    dist_outside = cv2.distanceTransform(1 - pen_mask, cv2.DIST_L2, 5)
    sdf = dist_inside - dist_outside

    alpha_blur = cv2.GaussianBlur(pen_mask.astype(np.float32), (3, 3), 0.75)

    alpha = np.zeros((h, w), dtype=np.uint8)
    alpha[sdf > 1.2] = 255
    alpha[sdf < -1.2] = 0

    edge = (sdf >= -1.2) & (sdf <= 1.2)
    edge_alpha = np.clip(alpha_blur * 255.0, 0, 255)
    alpha[edge] = edge_alpha[edge].astype(np.uint8)

    # 3. Khử viền trắng (De-fringing)
    result_bgr = bgr.copy().astype(np.float32)
    edge_pixels = (alpha > 0) & (alpha < 255)
    a_norm = (alpha[edge_pixels].astype(np.float32) / 255.0)[:, None]
    
    # Công thức un-premultiply từ nền trắng (255):
    # C = a * F + (1 - a) * 255  =>  F = (C - (1 - a) * 255) / a
    result_bgr[edge_pixels] = np.clip(
        (result_bgr[edge_pixels] - (1.0 - a_norm) * 255.0) / np.maximum(a_norm, 0.05),
        0, 255
    )

    rgba = np.dstack([result_bgr.astype(np.uint8), alpha])

    # 4. Ghi đè file
    cv2.imwrite(img_path, rgba)
    print(f"Xử lý thành công: {os.path.basename(img_path)} (Độ phân giải: {w}x{h})")

# Ví dụ chạy cho toàn bộ thư mục assets:
assets_dir = "/Users/xitrum/Documents/Dev/REA/xitrum-AI-studio/sidecar-whiteboard/assets"
for f in os.listdir(assets_dir):
    if f.endswith(".png") and not f.endswith(".bak.png"):
        make_pen_background_transparent(os.path.join(assets_dir, f))
EOF
```

---

## 4. Danh sách các asset bút đang sử dụng

Các asset bút nằm tại: `sidecar-whiteboard/assets/`

| Tên File | Loại bút | Đặc điểm cần chú ý khi xử lý |
| :--- | :--- | :--- |
| `calligraphy-brush.png` | Bút lông thư pháp | Có chữ khắc Hán tự trên cán tre; có móc dây xỏ phía đuôi bút |
| `bamboo-pen.png` | Bút cán tre | Có đốt tre & vân gỗ |
| `vintage-pen.png` | Bút máy cổ điển | Có kẹp cài kim loại (clip), ngòi vàng chạm khắc |
| `technical-drawing-pen.png` | Bút vẽ kỹ thuật | Có vạch số đo, thông số nét vẽ & kẹp cài bút |
| `cyberpunk-pen.png` | Bút phong cách Cyberpunk | Mạch điện, đèn LED viền, kẹp bút công nghệ cao |
| `digital-pen.png` | Bút cảm ứng kỹ thuật số | Nút bấm vật lý, đuôi sạc / tẩy kỹ thuật số |
| `crystal-pen.png` | Bút pha lê thủy tinh | Nhiều mặt cắt phản chiếu ánh sáng bên trong thân |
| `wand-pen.png` | Bút đũa phép thuật | Đính ngọc, nhiều đường vân cuộn uốn lượn |
| `quill-pen.png` | Bút lông vũ | Sợi lông xù tơ ở đuôi, thân ống lông tự nhiên |

---

## 5. Quy trình kiểm tra chất lượng (Verification)

Sau khi tách nền, luôn kiểm tra lại 3 tiêu chí:
1. **Kiểm tra độ trong suốt**:
   - Tỷ lệ `Alpha == 0` đạt từ 50% - 65% tổng diện tích ảnh.
2. **Kiểm tra chữ & chi tiết bên trong**:
   - Kiểm tra các pixel tối màu trên thân bút (`Gray < 60`), 100% các pixel này phải có `Alpha == 255`.
3. **Kiểm tra trên các nền khác nhau**:
   - Mở thử file ảnh trên cả nền đen tuyệt đối `#000000` và nền trắng `#FFFFFF` để đảm bảo không còn viền trắng mờ (halo fringe) xung quanh ngòi và thân bút.
