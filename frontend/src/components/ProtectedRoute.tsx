import { Navigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import type { ReactNode } from "react";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { connected } = useSession();
  if (!connected) return <Navigate to="/" replace />;
  return children;
}
