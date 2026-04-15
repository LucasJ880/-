"use client";

import { useCallback, useState } from "react";

export interface UseFormDialogReturn {
  open: boolean;
  setOpen: (open: boolean) => void;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  handleSubmit: (
    submitFn: () => Promise<void>,
    options?: { onSuccess?: () => void },
  ) => Promise<void>;
  reset: () => void;
}

/**
 * Encapsulates the common dialog submission flow:
 * open/close state, loading indicator, error display, and a
 * try/catch/finally wrapper that calls onSuccess + closes on success.
 */
export function useFormDialog(): UseFormDialogReturn {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
  }, []);

  const onOpenChange = useCallback(
    (value: boolean) => {
      setOpen(value);
      if (!value) reset();
    },
    [reset],
  );

  const handleSubmit = useCallback(
    async (
      submitFn: () => Promise<void>,
      options?: { onSuccess?: () => void },
    ) => {
      setLoading(true);
      setError(null);
      try {
        await submitFn();
        options?.onSuccess?.();
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "未知错误");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return {
    open,
    setOpen,
    onOpenChange,
    loading,
    error,
    setError,
    handleSubmit,
    reset,
  };
}
