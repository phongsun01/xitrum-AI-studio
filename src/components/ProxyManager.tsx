import React, { useState, useEffect } from "react";
import {
  Globe,
  Plus,
  Trash2,
  Zap,
  CheckCircle,
  XCircle,
  Clock,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import { api, ProxyItem, AppConfig } from "../api";

interface Props {
  onAddToast: (type: "success" | "error" | "info" | "warn", message: string) => void;
  config: AppConfig;
  onUpdateConfig: (newCfg: AppConfig) => void;
}

export const ProxyManager: React.FC<Props> = ({ onAddToast, config, onUpdateConfig }) => {
  const [proxies, setProxies] = useState<ProxyItem[]>([]);
  const [proxyInputText, setProxyInputText] = useState("");
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testingAll, setTestingAll] = useState(false);

  const loadProxies = async () => {
    try {
      const list = await api.listProxies();
      setProxies(list);
    } catch (e: any) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadProxies();
  }, []);

  const handleAddProxies = async () => {
    if (!proxyInputText.trim()) {
      onAddToast("warn", "Vui lòng nhập ít nhất 1 dòng proxy!");
      return;
    }

    try {
      const res = await api.addProxies(proxyInputText);
      setProxyInputText("");
      loadProxies();
      onAddToast(
        "success",
        `Đã thêm ${res.added} proxy${res.invalid > 0 ? ` (bỏ qua ${res.invalid} dòng sai định dạng)` : ""}`
      );
    } catch (e: any) {
      onAddToast("error", `Lỗi thêm proxy: ${e.message}`);
    }
  };

  const handleTestProxy = async (id: number) => {
    setTestingId(id);
    try {
      const res = await api.testProxy(id);
      loadProxies();
      if (res.ok) {
        onAddToast("success", `Proxy hoạt động tốt! IP: ${res.ip} (${res.latency_ms} ms)`);
      } else {
        onAddToast("error", `Proxy không kết nối được: ${res.error}`);
      }
    } catch (e: any) {
      onAddToast("error", `Lỗi test proxy: ${e.message}`);
    } finally {
      setTestingId(null);
    }
  };

  const handleTestAllProxies = async () => {
    if (proxies.length === 0) return;
    setTestingAll(true);
    onAddToast("info", "Đang bắt đầu kiểm tra toàn bộ danh sách proxy...");
    for (const p of proxies) {
      try {
        await api.testProxy(p.id);
      } catch {}
    }
    await loadProxies();
    setTestingAll(false);
    onAddToast("success", "Đã kiểm tra xong toàn bộ proxy!");
  };

  const handleDeleteProxy = async (id: number) => {
    try {
      await api.deleteProxy(id);
      if (config.active_proxy_id === id) {
        const updated = { ...config, active_proxy_id: null };
        await api.saveSettings(updated);
        onUpdateConfig(updated);
      }
      loadProxies();
      onAddToast("info", "Đã xóa proxy.");
    } catch (e: any) {
      onAddToast("error", `Lỗi xóa proxy: ${e.message}`);
    }
  };

  const handleDeleteDeadProxies = async () => {
    try {
      const count = await api.deleteDeadProxies();
      loadProxies();
      onAddToast("success", `Đã xóa ${count} proxy chết khỏi danh sách!`);
    } catch (e: any) {
      onAddToast("error", `Lỗi dọn proxy: ${e.message}`);
    }
  };

  const handleSelectActiveProxy = async (id: number | null) => {
    try {
      const updated = { ...config, active_proxy_id: id };
      await api.saveSettings(updated);
      onUpdateConfig(updated);
      onAddToast("success", id ? "Đã gán proxy hoạt động cho Muse Runner!" : "Đã chuyển sang chạy trực tiếp (Không dùng Proxy)");
    } catch (e: any) {
      onAddToast("error", `Lỗi gán proxy: ${e.message}`);
    }
  };

  return (
    <div className="panel-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <div>
          <h3>🌐 Quản Lý & Tích Hợp Proxy Bảo Mật</h3>
          <p className="panel-desc" style={{ marginBottom: 0 }}>
            Quản lý danh sách Proxy HTTP / SOCKS5 để điều hướng Muse Runner qua IP riêng. Mật khẩu được mã hóa an toàn trong database.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className="secondary-btn"
            onClick={handleTestAllProxies}
            disabled={testingAll || proxies.length === 0}
          >
            {testingAll ? <RotateCw size={14} className="spin" /> : <Zap size={14} />} Kiểm Tra Tất Cả
          </button>
          <button
            className="secondary-btn"
            style={{ color: "#ef4444", borderColor: "#fecaca" }}
            onClick={handleDeleteDeadProxies}
          >
            <Trash2 size={14} /> Xóa Proxy Chết
          </button>
        </div>
      </div>

      {/* FORM NHẬP PROXY HÀNG LOẠT */}
      <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "10px", border: "1px solid var(--border-color)", marginBottom: "20px" }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Thêm Proxy hàng loạt (Mỗi proxy 1 dòng):</span>
            <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: "normal" }}>
              Hỗ trợ: <code>host:port</code> • <code>host:port:user:pass</code> • <code>scheme://user:pass@host:port</code>
            </span>
          </label>
          <textarea
            rows={4}
            placeholder={`123.45.67.89:8080\n123.45.67.89:8080:username:mypassword\nsocks5://user:pass@123.45.67.89:1080`}
            value={proxyInputText}
            onChange={(e) => setProxyInputText(e.target.value)}
            style={{ fontFamily: "monospace", fontSize: "13px", marginTop: "6px" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
            <button className="primary-btn" onClick={handleAddProxies}>
              <Plus size={16} /> Thêm Vào Danh Sách
            </button>
          </div>
        </div>
      </div>

      {/* PROXY CURRENT STATUS */}
      <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "10px", fontSize: "13px" }}>
        <span>Proxy đang gán cho Muse Runner:</span>
        <select
          value={config.active_proxy_id || ""}
          onChange={(e) => handleSelectActiveProxy(e.target.value ? Number(e.target.value) : null)}
          style={{ padding: "4px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
        >
          <option value="">— Chạy trực tiếp (Không qua Proxy) —</option>
          {proxies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.status === "ok" ? "🟢 " : p.status === "dead" ? "🔴 " : "⚪ "}
              {p.scheme.toUpperCase()}://{p.host}:{p.port} {p.ip ? `(IP: ${p.ip})` : ""}
            </option>
          ))}
        </select>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "#16a34a", fontSize: "12px" }}>
          <ShieldCheck size={14} /> Mật khẩu proxy được mã hóa
        </span>
      </div>

      {/* PROXY TABLE */}
      {proxies.length === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)", border: "1px dashed var(--border-color)", borderRadius: "8px" }}>
          <Globe size={32} style={{ margin: "0 auto 8px auto", opacity: 0.4 }} />
          Chưa có proxy nào trong danh sách. Hãy dán proxy vào ô phía trên để thêm mới.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border-color)", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
            <thead style={{ background: "#f8fafc", borderBottom: "1px solid var(--border-color)" }}>
              <tr>
                <th style={{ padding: "10px 14px" }}>Địa Chỉ Proxy</th>
                <th style={{ padding: "10px 14px" }}>Giao Thức</th>
                <th style={{ padding: "10px 14px" }}>Trạng Thái</th>
                <th style={{ padding: "10px 14px" }}>IP Public Thực Tế</th>
                <th style={{ padding: "10px 14px" }}>Độ Trễ</th>
                <th style={{ padding: "10px 14px", textAlign: "right" }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {proxies.map((p) => {
                const isActive = config.active_proxy_id === p.id;
                return (
                  <tr
                    key={p.id}
                    style={{
                      borderBottom: "1px solid var(--border-color)",
                      background: isActive ? "rgba(59, 130, 246, 0.05)" : "transparent",
                    }}
                  >
                    <td style={{ padding: "10px 14px", fontFamily: "monospace" }}>
                      <b>{p.host}:{p.port}</b>
                      {p.username && <span style={{ color: "var(--text-muted)", marginLeft: "6px" }}>({p.username})</span>}
                      {isActive && <span style={{ marginLeft: "8px", color: "var(--primary)", fontWeight: 600 }}>[Đang dùng]</span>}
                    </td>
                    <td style={{ padding: "10px 14px", textTransform: "uppercase", fontSize: "12px", color: "var(--text-muted)" }}>
                      {p.scheme}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {p.status === "ok" && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "#16a34a", fontWeight: 600 }}>
                          <CheckCircle size={14} /> Hoạt động
                        </span>
                      )}
                      {p.status === "dead" && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "#ef4444", fontWeight: 600 }}>
                          <XCircle size={14} /> Chết / Lỗi
                        </span>
                      )}
                      {p.status === "checking" && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "#eab308" }}>
                          <RotateCw size={14} className="spin" /> Đang kiểm tra...
                        </span>
                      )}
                      {p.status === "unknown" && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--text-muted)" }}>
                          <Clock size={14} /> Chưa kiểm tra
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", fontFamily: "monospace" }}>
                      {p.ip || <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {p.latency_ms !== null ? (
                        <span style={{ color: p.latency_ms < 500 ? "#16a34a" : "#eab308" }}>
                          {p.latency_ms} ms
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                        <button
                          className="secondary-btn"
                          style={{ padding: "4px 8px", fontSize: "12px" }}
                          onClick={() => handleTestProxy(p.id)}
                          disabled={testingId === p.id}
                          title="Kiểm tra kết nối proxy này"
                        >
                          {testingId === p.id ? <RotateCw size={12} className="spin" /> : <Zap size={12} />} Test
                        </button>
                        <button
                          className="secondary-btn"
                          style={{ padding: "4px 8px", fontSize: "12px", color: "#ef4444", borderColor: "#fecaca" }}
                          onClick={() => handleDeleteProxy(p.id)}
                          title="Xóa proxy này"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
