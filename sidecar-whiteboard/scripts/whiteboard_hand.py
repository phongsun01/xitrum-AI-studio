"""
whiteboard_hand.py - Rig bàn tay vẽ, cổ tay xoay và bóng đổ (R4)

Bao gồm:
- HandRig: Quản lý asset bàn tay vẽ/bút lông, tỉ lệ scale, anchor đầu bút,
  góc xoay cổ tay nhẹ (wrist rotation) bám theo hướng di chuyển của nét vẽ (dx, dy),
  trạng thái nhấc bút (pen-up: nhấc nhẹ lên cao, thu nhỏ bóng đổ và giảm kích thước tiếp xúc),
  và đổ bóng mềm (contact shadow).
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Optional, Tuple
import cv2
import numpy as np


class HandRig:
    def __init__(
        self,
        hand_bgr: np.ndarray,
        hand_mask: np.ndarray,
        anchor_x: float = 0.0,
        anchor_y: float = 0.0,
        scale: float = 1.0,
    ):
        self.raw_hand = hand_bgr
        self.raw_mask = hand_mask
        self.anchor_x = float(anchor_x)
        self.anchor_y = float(anchor_y)
        self.base_scale = float(scale)

        self.h0, self.w0 = hand_bgr.shape[:2]
        self.tip_px = int(round((self.w0 - 1) * np.clip(self.anchor_x, 0.0, 1.0)))
        self.tip_py = int(round((self.h0 - 1) * np.clip(self.anchor_y, 0.0, 1.0)))

    @classmethod
    def from_image(
        cls,
        image_path: str | Path,
        target_height: int = 370,
        anchor_x: float = 0.0,
        anchor_y: float = 0.0,
    ) -> Optional["HandRig"]:
        p = Path(image_path)
        if not p.is_file():
            return None

        import whiteboard_image
        raw = whiteboard_image.imread_safe(p, cv2.IMREAD_UNCHANGED)
        if raw is None:
            return None

        if raw.ndim == 3 and raw.shape[2] == 4:
            hand = raw[:, :, :3]
            mask = raw[:, :, 3].astype(np.float32) / 255.0
        else:
            hand = raw if raw.ndim == 3 else cv2.cvtColor(raw, cv2.COLOR_GRAY2BGR)
            gray = cv2.cvtColor(hand, cv2.COLOR_BGR2GRAY)
            _, mask_u8 = cv2.threshold(gray, 245, 255, cv2.THRESH_BINARY_INV)
            mask = mask_u8.astype(np.float32) / 255.0

        # Cắt đến bounding box nội dung tay
        ys, xs = np.nonzero(mask > 0.05)
        if len(ys) == 0:
            return None
        y0, y1 = int(ys.min()), int(ys.max())
        x0, x1 = int(xs.min()), int(xs.max())
        hand = hand[y0 : y1 + 1, x0 : x1 + 1]
        mask = mask[y0 : y1 + 1, x0 : x1 + 1]

        # Scale theo target_height
        scale = float(target_height) / max(1.0, float(hand.shape[0]))
        new_w = max(1, int(round(hand.shape[1] * scale)))
        new_h = target_height
        hand = cv2.resize(hand, (new_w, new_h), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
        mask = cv2.resize(mask, (new_w, new_h), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)

        # Xóa các pixel ngoài mask
        hand[mask <= 0.01] = 0

        # Nếu là bút lông thư pháp (tên file hoặc tỉ lệ cao), chỉnh anchor đầu ngòi
        if "calligraphy" in str(p).lower() and anchor_x == 0.0 and anchor_y == 0.0:
            # Ngòi bút lông thường nằm ở đỉnh nhọn trên cùng bên trái
            anchor_x = 0.08
            anchor_y = 0.04

        return cls(hand, mask, anchor_x=anchor_x, anchor_y=anchor_y)

    def stamp(
        self,
        canvas_bgr: np.ndarray,
        x: int,
        y: int,
        pen_down: bool = True,
        dx: float = 0.0,
        dy: float = 0.0,
    ) -> np.ndarray:
        """
        Dán bàn tay vẽ lên canvas với:
        - Xoay nhẹ góc cổ tay theo hướng di chuyển (-10 đến +10 độ)
        - Khi pen_down=False (nhấc bút): bàn tay nhấc lùi lên trên 8px, bóng đổ mờ hơn
        - Đổ bóng nhẹ (contact shadow) dưới ngòi bút khi tiếp xúc
        """
        canvas_h, canvas_w = canvas_bgr.shape[:2]

        # 1. Tính góc xoay cổ tay nhẹ
        angle_deg = 0.0
        if abs(dx) > 0.5 or abs(dy) > 0.5:
            move_angle = math.degrees(math.atan2(dy, dx))
            # Hạn chế góc xoay mềm mại trong khoảng [-8, 8] độ để không bị giật
            angle_deg = math.sin(math.radians(move_angle)) * 6.0

        # 2. Xử lý trạng thái nhấc bút (pen-up lift)
        lift_offset_y = 0 if pen_down else -8
        lift_scale = 1.0 if pen_down else 0.98

        hand_img = self.raw_hand
        hand_msk = self.raw_mask

        # Nếu có xoay góc hoặc đổi scale
        if abs(angle_deg) > 0.5 or abs(lift_scale - 1.0) > 0.01:
            M = cv2.getRotationMatrix2D((self.tip_px, self.tip_py), angle_deg, lift_scale)
            hand_img = cv2.warpAffine(hand_img, M, (self.w0, self.h0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0,0,0))
            hand_msk = cv2.warpAffine(hand_msk, M, (self.w0, self.h0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)

        # 3. Tọa độ dán lên canvas
        target_x = x
        target_y = y + lift_offset_y

        top_left_x = target_x - self.tip_px
        top_left_y = target_y - self.tip_py

        x0 = max(0, top_left_x)
        y0 = max(0, top_left_y)
        x1 = min(canvas_w, top_left_x + self.w0)
        y1 = min(canvas_h, top_left_y + self.h0)

        if x1 <= x0 or y1 <= y0:
            return canvas_bgr

        # Vùng cắt tương ứng trên tay
        sx0 = x0 - top_left_x
        sy0 = y0 - top_left_y
        sx1 = sx0 + (x1 - x0)
        sy1 = sy0 + (y1 - y0)

        sub_canvas = canvas_bgr[y0:y1, x0:x1]
        sub_hand = hand_img[sy0:sy1, sx0:sx1]
        sub_mask = hand_msk[sy0:sy1, sx0:sx1][:, :, None]

        # 4. Đổ bóng tiếp xúc (Contact shadow nhẹ khi hạ bút)
        if pen_down and (x1 - x0) > 10 and (y1 - y0) > 10:
            shadow_mask = cv2.GaussianBlur(sub_mask[:, :, 0], (11, 11), 0)
            shadow_inv = 1.0 - (shadow_mask[:, :, None] * 0.15)
            sub_canvas = (sub_canvas.astype(np.float32) * shadow_inv).astype(np.uint8)

        # Trộn alpha bàn tay lên canvas
        inv_mask = 1.0 - sub_mask
        blended = (sub_canvas.astype(np.float32) * inv_mask + sub_hand.astype(np.float32) * sub_mask).astype(np.uint8)
        canvas_bgr[y0:y1, x0:x1] = blended
        return canvas_bgr

