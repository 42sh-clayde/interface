import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  connect as apiConnect,
  disconnect as apiDisconnect,
  fetchLogs,
  sessionStatus,
  type ConnectInfo,
  type LogEntry,
} from "../api";

interface SessionContextValue {
  connected: boolean;
  info: ConnectInfo | null;
  logs: LogEntry[];
  refreshLogs: () => Promise<void>;
  connect: (pat: string) => Promise<void>;
  disconnect: () => Promise<void>;
  checkStatus: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const refreshLogs = useCallback(async () => {
    try {
      const entries = await fetchLogs();
      setLogs(entries);
    } catch {
      setLogs([]);
    }
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const status = await sessionStatus();
      if ("connected" in status && status.connected && status.org) {
        setConnected(true);
        setInfo(status as ConnectInfo);
        await refreshLogs();
      } else {
        setConnected(false);
        setInfo(null);
      }
    } catch {
      setConnected(false);
      setInfo(null);
    }
  }, [refreshLogs]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const connect = useCallback(
    async (pat: string) => {
      const result = await apiConnect(pat);
      setConnected(true);
      setInfo(result);
      await refreshLogs();
    },
    [refreshLogs],
  );

  const disconnect = useCallback(async () => {
    await apiDisconnect();
    setConnected(false);
    setInfo(null);
    setLogs([]);
  }, []);

  const value = useMemo(
    () => ({
      connected,
      info,
      logs,
      refreshLogs,
      connect,
      disconnect,
      checkStatus,
    }),
    [connected, info, logs, refreshLogs, connect, disconnect, checkStatus],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
