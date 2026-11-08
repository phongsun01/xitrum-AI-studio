import React, { useState, useEffect } from "react";
import {
  Users,
  Plus,
  Trash2,
  RotateCw,
  FolderOpen,
} from "lucide-react";
import { api, AccountItem, ProviderDescriptor, ProxyItem } from "../api";

interface Props {
  onAddToast: (type: "success" | "error" | "info" | "warn", message: string) => void;
  proxies: ProxyItem[];
}

export const AccountManager: React.FC<Props> = ({ onAddToast, proxies }) => {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [descriptors, setDescriptors] = useState<ProviderDescriptor[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  // Form State
  const [selectedProvider, setSelectedProvider] = useState("muse");
  const [accountName, setAccountName] = useState("");
  const [profilePath, setProfilePath] = useState("");
  const [proxyId, setProxyId] = useState<number | undefined>(undefined);
  const [maxConcurrency, setMaxConcurrency] = useState(1);

  const loadData = async () => {
    setLoading(true);
    try {
      const [accs, descs] = await Promise.all([
        api.listAccounts(),
        api.listProviderDescriptors(),
      ]);
      setAccounts(accs);
      setDescriptors(descs);
      if (descs.length > 0 && !selectedProvider) {
        setSelectedProvider(descs[0].id);
      }
    } catch (e: any) {
      console.error(e);
      onAddToast("error", `Lỗi tải danh sách tài khoản: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveAccount = async () => {
    if (!accountName.trim()) {
      onAddToast("warn", "Vui lòng nhập tên tài khoản!");
      return;
    }

    const newAcc: AccountItem = {
      id: `${selectedProvider}_${Date.now().toString(36)}`,
      provider: selectedProvider,
      name: accountName.trim(),
      profile_path: profilePath.trim() || null,
      proxy_id: proxyId ? Number(proxyId) : null,
      readiness: "ready",
      max_concurrency: Math.max(1, maxConcurrency),
      created_at: Math.floor(Date.now() / 1000),
    };

    try {
      await api.saveAccount(newAcc);
      onAddToast("success", `Đã lưu tài khoản '${newAcc.name}' cho ${selectedProvider}!`);
      setAccountName("");
      setProfilePath("");
      setProxyId(undefined);
      loadData();
    } catch (e: any) {
      onAddToast("error", `Lỗi lưu tài khoản: ${e.message}`);
    }
  };

  const handleDeleteAccount = async (id: string, name: string) => {
    if (!confirm(`Bạn có chắc muốn xóa tài khoản "${name}"?`)) return;
    try {
      await api.deleteAccount(id);
      onAddToast("info", `Đã xóa tài khoản "${name}"`);
      loadData();
    } catch (e: any) {
      onAddToast("error", `Lỗi xóa tài khoản: ${e.message}`);
    }
  };

  const handleCheckSession = async (id: string) => {
    setCheckingId(id);
    try {
      const res = await api.checkAccountSession(id);
      if (res.ok) {
        onAddToast("success", `Tài khoản hợp lệ: ${res.message}`);
      } else {
        onAddToast("error", `Phiên đăng nhập hết hạn hoặc lỗi: ${res.message}`);
      }
      loadData();
    } catch (e: any) {
      onAddToast("error", `Lỗi kiểm tra session: ${e.message}`);
    } finally {
      setCheckingId(null);
    }
  };

  const activeDescriptor = descriptors.find((d) => d.id === selectedProvider);

  return (
    <div className="panel-card" style={{ marginTop: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
        <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
          <Users size={18} style={{ color: "var(--primary)" }} /> Quản Lý Provider & Tài Khoản (G3 Isolation)
        </h3>
        <button className="secondary-btn sm-btn" onClick={loadData} disabled={loading}>
          <RotateCw size={13} className={loading ? "spin" : ""} /> Làm Mới
        </button>
      </div>

      <p className="panel-desc">
        Tách biệt Browser Profile và Proxy độc lập cho từng tài khoản và từng nền tảng AI (Muse, Dola, Midjourney...). Chống xung đột session và phân bổ luồng (Concurrency Limit) tối ưu.
      </p>

      {/* FORM THÊM TÀI KHOẢN MỚI */}
      <div
        style={{
          background: "var(--bg-secondary, rgba(255,255,255,0.03))",
          padding: "16px",
          borderRadius: "8px",
          border: "1px solid var(--border-color)",
          marginBottom: "20px",
        }}
      >
        <h4 style={{ margin: "0 0 12px 0", fontSize: "14px" }}>+ Thêm Tài Khoản Mới</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: "12px" }}>Nhà Cung Cấp (Provider):</label>
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              style={{ width: "100%", height: "38px" }}
            >
              {descriptors.map((desc) => (
                <option key={desc.id} value={desc.id}>
                  {desc.name} ({desc.models.length} model{desc.models.length > 1 ? "s" : ""})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: "12px" }}>Tên Tài Khoản / Ghi Chú:</label>
            <input
              type="text"
              placeholder="VD: Muse Account 01, Dola VIP..."
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              style={{ height: "38px" }}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: "12px" }}>Đường Dẫn Profile Trình Duyệt Riêng (Tùy chọn):</label>
            <div className="input-with-button">
              <input
                type="text"
                placeholder="Để trống nếu muốn dùng profile mặc định..."
                value={profilePath}
                onChange={(e) => setProfilePath(e.target.value)}
                style={{ height: "38px" }}
              />
              <button
                type="button"
                className="secondary-btn"
                style={{ height: "38px" }}
                onClick={async () => {
                  const dir = await api.pickDirectory();
                  if (dir) setProfilePath(dir);
                }}
              >
                <FolderOpen size={14} /> Chọn...
              </button>
            </div>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: "12px" }}>Gắn Proxy Riêng:</label>
            <select
              value={proxyId ?? ""}
              onChange={(e) => setProxyId(e.target.value ? Number(e.target.value) : undefined)}
              style={{ width: "100%", height: "38px" }}
            >
              <option value="">Không dùng proxy riêng</option>
              {proxies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.raw_masked} ({p.status})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: "12px" }}>Giới Hạn Luồng Song Song:</label>
            <input
              type="number"
              min={1}
              max={10}
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(Number(e.target.value))}
              style={{ height: "38px" }}
            />
          </div>
        </div>

        {/* THÔNG TIN MODEL CỦA PROVIDER */}
        {activeDescriptor && (
          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "14px" }}>
            <b>Models hỗ trợ:</b>{" "}
            {activeDescriptor.models.map((m) => (
              <span
                key={m.model_id}
                style={{
                  display: "inline-block",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: "rgba(59, 130, 246, 0.1)",
                  color: "var(--primary)",
                  marginRight: "6px",
                  fontSize: "11px",
                }}
              >
                {m.name} ({m.supported_ratios.join(", ")})
              </span>
            ))}
          </div>
        )}

        <button className="primary-btn sm-btn" onClick={handleSaveAccount}>
          <Plus size={14} /> Thêm Tài Khoản
        </button>
      </div>

      {/* DANH SÁCH TÀI KHOẢN ĐANG CÓ */}
      <h4 style={{ margin: "16px 0 10px 0", fontSize: "14px" }}>📋 Danh Sách Tài Khoản Đã Cấu Hình</h4>
      {accounts.length === 0 ? (
        <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
          Chưa có tài khoản nào được cấu hình riêng. Hệ thống đang sử dụng cấu hình mặc định toàn cục.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {accounts.map((acc) => {
            const boundProxy = proxies.find((p) => p.id === acc.proxy_id);
            return (
              <div
                key={acc.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  background: "var(--card-bg, #ffffff)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <b style={{ fontSize: "14px" }}>{acc.name}</b>
                    <span
                      style={{
                        fontSize: "11px",
                        textTransform: "uppercase",
                        padding: "1px 6px",
                        borderRadius: "3px",
                        background: "#f1f5f9",
                        color: "#475569",
                        fontWeight: 600,
                      }}
                    >
                      {acc.provider}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        padding: "1px 6px",
                        borderRadius: "3px",
                        fontWeight: 600,
                        background: acc.readiness === "ready" ? "#ecfdf5" : "#fef2f2",
                        color: acc.readiness === "ready" ? "#059669" : "#dc2626",
                      }}
                    >
                      {acc.readiness === "ready" ? "✓ Sẵn sàng" : `⚠️ ${acc.readiness}`}
                    </span>
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                    <span>Tối đa: <b>{acc.max_concurrency} luồng</b></span>
                    {boundProxy && <span> • Proxy: <code>{boundProxy.raw_masked}</code></span>}
                    {acc.profile_path && <span> • Profile: <code>{acc.profile_path}</code></span>}
                    {acc.last_checked_at && (
                      <span> • Kiểm tra: {new Date(acc.last_checked_at * 1000).toLocaleTimeString("vi-VN")}</span>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <button
                    className="secondary-btn sm-btn"
                    disabled={checkingId === acc.id}
                    onClick={() => handleCheckSession(acc.id)}
                    title="Kiểm tra trạng thái đăng nhập session"
                  >
                    <RotateCw size={13} className={checkingId === acc.id ? "spin" : ""} />
                    {checkingId === acc.id ? "Đang ktra..." : "Kiểm Tra Session"}
                  </button>
                  <button
                    className="secondary-btn sm-btn"
                    style={{ color: "#ef4444", borderColor: "#fecaca" }}
                    onClick={() => handleDeleteAccount(acc.id, acc.name)}
                    title="Xóa tài khoản"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
