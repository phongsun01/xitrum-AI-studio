import React, { useState } from "react";
import { TemplateItem } from "../api";
import { Bookmark, Plus, Trash2, Check, Copy } from "lucide-react";

interface Props {
  templates: TemplateItem[];
  onApply: (tpl: TemplateItem) => void;
  onSave: (name: string, prompt: string, ratio?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export const TemplateLibrary: React.FC<Props> = ({
  templates,
  onApply,
  onSave,
  onDelete,
}) => {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim()) return;
    setSaving(true);
    try {
      await onSave(name.trim(), prompt.trim(), ratio);
      setName("");
      setPrompt("");
      setIsCreating(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel-card template-library-card">
      <div className="template-header">
        <div>
          <h3>📚 Thư Viện Mẫu Prompt & Preset (Templates)</h3>
          <p className="panel-desc">
            Lưu lại các prompt hay dùng để tái sử dụng nhanh cho các lần tạo task tiếp theo.
          </p>
        </div>
        <button
          className="secondary-btn"
          onClick={() => setIsCreating(!isCreating)}
        >
          <Plus size={16} /> {isCreating ? "Đóng Form" : "Tạo Mẫu Mới"}
        </button>
      </div>

      {isCreating && (
        <form className="template-form" onSubmit={handleSave}>
          <div className="form-group">
            <label>Tên Mẫu / Preset:</label>
            <input
              type="text"
              placeholder="VD: Fashion Model Dạo Phố, Cyberpunk Neon..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Nội Dung Prompt:</label>
            <textarea
              rows={3}
              placeholder="Nhập nội dung prompt chi tiết..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
            />
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>Tỉ lệ mặc định:</label>
              <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
                <option value="16:9">16:9 (YouTube/Ngang)</option>
                <option value="9:16">9:16 (TikTok/Reels/Dọc)</option>
                <option value="1:1">1:1 (Vuông)</option>
              </select>
            </div>
            <button
              type="submit"
              className="primary-btn"
              disabled={saving}
              style={{ alignSelf: "flex-end" }}
            >
              <Check size={16} /> {saving ? "Đang lưu..." : "Lưu Vào Thư Viện"}
            </button>
          </div>
        </form>
      )}

      <div className="template-grid">
        {templates.length === 0 ? (
          <div className="empty-box" style={{ width: "100%" }}>
            Chưa có mẫu nào trong thư viện. Bấm "Tạo Mẫu Mới" ở trên để thêm preset đầu tiên!
          </div>
        ) : (
          templates.map((tpl) => (
            <div key={tpl.id} className="template-card">
              <div className="template-card-header">
                <div className="template-card-title">
                  <Bookmark size={16} className="text-primary" />
                  <strong>{tpl.name}</strong>
                </div>
                {tpl.ratio && <span className="ratio-tag">{tpl.ratio}</span>}
              </div>
              <p className="template-prompt-text">{tpl.prompt}</p>
              <div className="template-card-actions">
                <button
                  className="primary-btn sm-btn"
                  onClick={() => onApply(tpl)}
                  title="Điền vào form tạo task"
                >
                  <Copy size={14} /> Áp Dụng
                </button>
                <button
                  className="danger-btn sm-btn"
                  onClick={() => onDelete(tpl.id)}
                  title="Xóa mẫu này"
                >
                  <Trash2 size={14} /> Xóa
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

