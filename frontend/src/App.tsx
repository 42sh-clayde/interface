import { Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider } from "./context/SessionContext";
import { LogDrawer } from "./components/LogDrawer";
import { HubPage } from "./pages/HubPage";
import { ExtractionPage } from "./pages/ExtractionPage";
import { DeploymentPage } from "./pages/DeploymentPage";
import { ProtectedRoute } from "./components/ProtectedRoute";

export default function App() {
  return (
    <SessionProvider>
      <div className="app-shell">
        <Routes>
          <Route path="/" element={<HubPage />} />
          <Route
            path="/extraction"
            element={
              <ProtectedRoute>
                <ExtractionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/deployment"
            element={
              <ProtectedRoute>
                <DeploymentPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <LogDrawer />
      </div>
    </SessionProvider>
  );
}
