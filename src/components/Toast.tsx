import React from "react";
import { CheckCircle, AlertCircle, Info, X } from "lucide-react";

export interface ToastItem {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

interface Props {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<Props> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast-item toast-${t.type}`}>
          <div className="toast-icon">
            {t.type === "success" && <CheckCircle size={18} />}
            {t.type === "error" && <AlertCircle size={18} />}
            {t.type === "info" && <Info size={18} />}
          </div>
          <div className="toast-message">{t.message}</div>
          <button className="toast-close" onClick={() => onDismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};

