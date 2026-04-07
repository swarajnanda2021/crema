import { Routes, Route, Navigate } from "react-router-dom";
import Navbar from "./components/Navbar";
import BrowsePage from "./pages/BrowsePage";
import CoffeePage from "./pages/CoffeePage";
import RoasterPage from "./pages/RoasterPage";
import { CoffeeDataProvider } from "./hooks/useCoffeeData";
import { AuthProvider, useAuth } from "./community/hooks/useAuth";
import AuthPage from "./community/pages/AuthPage";
import MyShelfPage from "./community/pages/MyShelfPage";
import FeedPage from "./community/pages/FeedPage";
import UserProfilePage from "./community/pages/UserProfilePage";

function AuthGuard({ children }) {
  const { user, backendAvailable, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <p style={{ color: "var(--color-text-secondary)" }}>Loading...</p>
      </div>
    );
  }
  if (!backendAvailable || !user) return <Navigate to="/auth" replace />;
  return children;
}

function AppShell() {
  return (
    <div className="min-h-screen" style={{ background: "var(--color-bg)" }}>
      <Navbar />
      <main className="pt-14">
        <Routes>
          {/* Feed = home (Crema logo links here) */}
          <Route path="/" element={<AuthGuard><FeedPage /></AuthGuard>} />

          {/* My Shelf / Profile */}
          <Route path="/profile" element={<AuthGuard><MyShelfPage /></AuthGuard>} />

          {/* Other user's profile */}
          <Route path="/user/:username" element={<AuthGuard><UserProfilePage /></AuthGuard>} />

          {/* Auth */}
          <Route path="/auth" element={<AuthPage />} />

          {/* Browse (Beans + Roasters sub-tabs) */}
          <Route path="/browse" element={<BrowsePage />} />

          {/* Detail pages */}
          <Route path="/coffee/:productId" element={<CoffeePage />} />
          <Route path="/roaster/:roasterSlug" element={<RoasterPage />} />

          {/* Legacy redirects */}
          <Route path="/my-shelf" element={<Navigate to="/profile" replace />} />
          <Route path="/roasters" element={<Navigate to="/browse?tab=roasters" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CoffeeDataProvider>
        <AppShell />
      </CoffeeDataProvider>
    </AuthProvider>
  );
}
