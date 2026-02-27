import { useEffect, type ReactNode } from "react";

interface FormModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  error?: string | null;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  confirmLoading?: boolean;
  confirmVariant?: "default" | "warning";
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional extra button rendered before the confirm button */
  extraButton?: ReactNode;
}

export default function FormModal({
  open,
  title,
  children,
  error,
  confirmLabel = "Confirm",
  confirmDisabled,
  confirmLoading,
  confirmVariant = "default",
  onConfirm,
  onCancel,
  extraButton,
}: FormModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  const confirmColor =
    confirmVariant === "warning"
      ? "bg-yellow-600 hover:bg-yellow-500"
      : "bg-accent-600 hover:bg-accent-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative mx-4 w-full max-w-sm rounded-lg border border-gray-700 bg-gray-900 px-6 py-5 shadow-xl">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <div className="mt-4 space-y-4">
          {children}
        </div>
        {error && (
          <p className="mt-4 text-sm text-red-400">{error}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded px-4 py-2 text-sm text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
          >
            Cancel
          </button>
          {extraButton}
          <button
            onClick={onConfirm}
            disabled={confirmDisabled || confirmLoading}
            className={`rounded px-4 py-2 text-sm font-medium text-white transition ${confirmColor} disabled:opacity-50`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
