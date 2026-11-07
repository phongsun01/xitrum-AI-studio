# Hướng Dẫn Nâng Phiên Bản (Version Bump) Xitrum AI Studio

> Tài liệu tổng hợp danh sách các file cần cập nhật khi tăng version dự án trước khi commit & đẩy (push) lên GitHub.

---

## 📋 Danh Sách Các File Cần Sửa

Khi tăng version (ví dụ từ `0.7.1` lên `0.7.2` hoặc `0.8.0`), bạn cần cập nhật đồng bộ ở **5 file** sau:

### 1. `package.json` (Frontend Package)
```json
{
  "name": "xitrum-ai-studio",
  "private": true,
  "version": "0.7.2",   <--- Sửa tại đây
  "type": "module",
...
```

### 2. `src-tauri/tauri.conf.json` (Cấu hình ứng dụng Tauri)
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Xitrum AI Studio",
  "version": "0.7.2",   <--- Sửa tại đây
  "identifier": "com.xitrum.ai.studio",
...
```

### 3. `src-tauri/Cargo.toml` (Cấu hình crate Rust Backend)
```toml
[package]
name = "xitrum-ai-studio"
version = "0.7.2"      <--- Sửa tại đây
description = "Xitrum AI Studio desktop app on Tauri v2"
```

### 4. `src/App.tsx` (Badge hiển thị version trên thanh Header giao diện)
Tại thẻ `<header className="top-bar">`:
```tsx
<div className="title-section">
  <h1>Xitrum AI Studio</h1>
  <span className="version-badge">v0.7.2 • Rust Multi-Lane • Offline Engine</span>  <--- Sửa tại đây
</div>
```

### 5. `README.md` (Tài liệu giới thiệu phiên bản dự án)
Tại dòng tiêu đề phiên bản hiện tại:
```markdown
## 📦 Phiên Bản Hiện Tại: v0.7.2 (<Tên tính năng chính của bản phát hành>)
```

---

## ⚡ Các Lệnh Cần Chạy Sau Khi Đổi Version

Sau khi đổi version ở 5 file trên, chạy các lệnh sau để cập nhật lockfiles, kiểm tra, tạo Git Tag và đẩy lên GitHub:

```bash
# 1. Cập nhật Cargo.lock cho Rust
cd src-tauri && cargo check && cd ..

# 2. Build thử Frontend để đảm bảo TypeScript & Vite không lỗi
npm run build

# 3. Commit thay đổi phiên bản
git add -A
git commit -m "chore(release): bump version to v0.7.2"

# 4. Tạo Git Tag (gắn nhãn phiên bản)
git tag -a v0.7.2 -m "Release v0.7.2"

# 5. Đẩy (Push) cả commit nhánh main và Git Tag lên GitHub
git push origin main
git push origin v0.7.2
```

> 💡 **Mẹo**: Nếu muốn đẩy cùng lúc cả commit và tất cả các tags chưa push lên GitHub chỉ bằng 1 lệnh:
> ```bash
> git push origin main --tags
> ```

---

## 🏷️ Quản Lý Git Tags Khi Cần Thiết

- **Xem danh sách các tag hiện có**:
  ```bash
  git tag -n
  ```
- **Xóa tag ở local nếu tạo nhầm**:
  ```bash
  git tag -d v0.7.2
  ```
- **Xóa tag trên remote GitHub (nếu lỡ push nhầm)**:
  ```bash
  git push --delete origin v0.7.2
  ```

