import { useState, useCallback } from "react";

export function useLogger() {
  const [messages, setMessages] = useState([]);

  const log = useCallback((msg, type = "info") => {
    const timestamp = new Date().toLocaleTimeString();
    const logMsg = `[${timestamp}] ${msg}`;

    // Console log with colors based on type
    if (type === "error") {
      console.error(logMsg);
    } else if (type === "warn") {
      console.warn(logMsg);
    } else {
      console.log(logMsg);
    }

    // Store in state
    setMessages((prev) => [
      { message: logMsg, type, timestamp },
      ...prev.slice(0, 99), // Keep last 100 messages
    ]);
  }, []);

  const clearLogs = useCallback(() => {
    setMessages([]);
    console.log("Logs cleared");
  }, []);

  return { log, messages, clearLogs };
}
