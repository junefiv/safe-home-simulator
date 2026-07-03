"use client";

import { useEffect } from "react";

interface ToastProps {
  message: string | null;
  onClear: () => void;
}

export function Toast({ message, onClear }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onClear, 3000);
    return () => clearTimeout(timer);
  }, [message, onClear]);

  return (
    <div id="toast" className={message ? "show" : ""}>
      {message ?? "알림 메시지"}
    </div>
  );
}