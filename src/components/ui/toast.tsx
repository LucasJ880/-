"use client";

import { createContext, useContext, useCallback, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { X, CheckCircle2, AlertTriangle, Info, XCircle } from "lucide-react";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let _counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = `toast-${++_counter}`;
    setToasts((prev) => [...prev.slice(-4), { id, type, message }]);
    setTimeout(() => removeToast(id), 4000);
  }, [removeToast]);

  const value: ToastContextValue = {
    toast: addToast,
    success: useCallback((msg: string) => addToast(msg, "success"), [addToast]),
    error: useCallback((msg: string) => addToast(msg, "error"), [addToast]),
    warning: useCallback((msg: string) => addToast(msg, "warning"), [addToast]),
    info: useCallback((msg: string) => addToast(msg, "info"), [addToast]),
  };

  const iconMap: Record<ToastType, typeof CheckCircle2> = {
    success: CheckCircle2,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const colorMap: Record<ToastType, string> = {
    success: "border-[#2e7a56]/30 bg-[#2e7a56]/5 text-[#2e7a56]",
    error: "border-[#a63d3d]/30 bg-[#a63d3d]/5 text-[#a63d3d]",
    warning: "border-[#9a6a2f]/30 bg-[#9a6a2f]/5 text-[#9a6a2f]",
    info: "border-accent/30 bg-accent/5 text-accent",
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
          {toasts.map((t) => {
            const Icon = iconMap[t.type];
            return (
              <div
                key={t.id}
                className={cn(
                  "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg backdrop-blur-sm animate-in slide-in-from-right-5 fade-in duration-200",
                  colorMap[t.type]
                )}
              >
                <Icon size={16} className="mt-0.5 shrink-0" />
                <span className="flex-1 text-foreground">{t.message}</span>
                <button
                  type="button"
                  onClick={() => removeToast(t.id)}
                  className="shrink-0 text-muted hover:text-foreground"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
