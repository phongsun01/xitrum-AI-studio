# Thông báo về thành phần bên thứ ba / Third-party notices

Sesame Studio kèm theo các thành phần dưới đây. Mỗi thành phần thuộc giấy phép riêng của nó;
giấy phép của Sesame Studio (LICENSE.txt) không thay đổi các quyền đó.

| Thành phần | Phiên bản kèm theo | Giấy phép | Nguồn |
|---|---|---|---|
| Electron (kèm Chromium) | 33.4.11 | MIT; Chromium theo nhiều giấy phép — xem `LICENSES.chromium.html` trong thư mục cài | https://www.electronjs.org |
| FFmpeg (`ffmpeg.exe`, `ffprobe.exe` và các DLL `avcodec`, `avformat`, `avutil`, `avfilter`, `avdevice`, `swresample`, `swscale` trong thư mục `bin`) | n8.1.3 | **GNU LGPL v3** (bản dịch không bật GPL, không bật nonfree; xem `bin/FFMPEG-LICENSE.txt`) | https://ffmpeg.org/download.html |
| OpenH264 (liên kết trong FFmpeg để mã hoá H.264) | theo bản dịch FFmpeg | BSD 2-Clause (Cisco) | https://github.com/cisco/openh264 |
| yt-dlp (`bin/yt-dlp.exe`) | 2026.08.19 | The Unlicense (phạm vi công cộng) | https://github.com/yt-dlp/yt-dlp |
| Deno (`bin/deno.exe`) | 2.9.4 | MIT | https://deno.com |
| Phông chữ Be Vietnam Pro (ExtraBold) | — | SIL Open Font License 1.1 (xem `ui/assets/fonts/OFL-BeVietnamPro.txt`) | https://github.com/google/fonts/tree/main/ofl/bevietnampro |

## FFmpeg theo LGPL

FFmpeg được cung cấp dưới dạng thư viện dùng chung (DLL) cạnh `ffmpeg.exe`, nên bạn có thể thay bằng
bản FFmpeg LGPL khác (cùng dòng phiên bản) bằng cách chép đè vào thư mục `resources\bin`. Mã nguồn FFmpeg
có tại địa chỉ ở bảng trên. Sesame Studio không sửa mã nguồn FFmpeg.

## Biểu tượng và thương hiệu

Biểu tượng cờ quốc gia và logo dịch vụ/nền tảng trong giao diện chỉ dùng để giúp nhận diện dịch vụ.
Các tên và logo đó thuộc về chủ sở hữu tương ứng; Sesame Studio không liên kết với họ.

## Phần mềm bạn tự cài thêm (không kèm theo)

Google Chrome, Python 3, gói `edge-tts`, gói `vieneu`, CapCut: **không** được phân phối cùng Sesame Studio.
Bạn tự cài nếu muốn dùng các tính năng cần chúng và theo điều khoản của từng phần mềm đó.
