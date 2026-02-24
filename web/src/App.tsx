import { useState, useRef, useEffect } from "react";
import { BrowserRouter, Routes, Route, NavLink, useLocation } from "react-router";
import ErrorBoundary from "./components/ErrorBoundary";
import { isSuperAdmin } from "./api";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { useOnline } from "./hooks/useOnline";
import Login from "./pages/Login";
import SessionList from "./pages/SessionList";
import SessionDetail from "./pages/SessionDetail";
import SongCatalog from "./pages/SongCatalog";
import SongHistory from "./pages/SongHistory";
import PerformMode from "./pages/PerformMode";
import SetlistList from "./pages/SetlistList";
import SetlistDetail from "./pages/SetlistDetail";
import SetlistPerformMode from "./pages/SetlistPerformMode";
import Tuner from "./pages/Tuner";
import Admin from "./pages/Admin";

function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const online = useOnline();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on navigation
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {!online && (
        <div className="bg-yellow-600/90 px-4 pt-[env(safe-area-inset-top)] text-center text-sm font-medium text-white">
          <div className="py-1.5">Offline — showing cached data</div>
        </div>
      )}
      <header className={`border-b border-gray-800 px-4 py-3 ${online ? "pt-[max(0.75rem,env(safe-area-inset-top))]" : ""}`}>
        <div className="mx-auto flex max-w-5xl items-center gap-x-3 sm:gap-x-8">
          <NavLink to="/" className="flex items-center gap-1.5 text-xl font-bold text-white hover:text-indigo-300 transition">
            <span className="text-2xl" role="img" aria-label="jar">🫙</span>
            <span className="hidden sm:inline">JamJar</span>
          </NavLink>
          <nav className="flex flex-1 gap-0.5 text-xs sm:gap-4 sm:text-sm">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `py-2 px-1.5 sm:px-3 ${isActive ? "text-indigo-400" : "text-gray-400 hover:text-gray-200"}`
              }
            >
              <span className="sm:hidden">Recs</span>
              <span className="hidden sm:inline">Recordings</span>
            </NavLink>
            <NavLink
              to="/songs"
              className={({ isActive }) =>
                `py-2 px-1.5 sm:px-3 ${isActive ? "text-indigo-400" : "text-gray-400 hover:text-gray-200"}`
              }
            >
              Songs
            </NavLink>
            <NavLink
              to="/setlists"
              className={({ isActive }) =>
                `py-2 px-1.5 sm:px-3 ${isActive ? "text-indigo-400" : "text-gray-400 hover:text-gray-200"}`
              }
            >
              Setlists
            </NavLink>
            <NavLink
              to="/tuner"
              className={({ isActive }) =>
                `py-2 px-1.5 sm:px-3 ${isActive ? "text-indigo-400" : "text-gray-400 hover:text-gray-200"}`
              }
            >
              Tuner
            </NavLink>
          </nav>
          {user && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500"
                aria-label="Account menu"
              >
                {(user.name || user.email).slice(0, 2).toUpperCase()}
              </button>
              {menuOpen && (
                <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-gray-700 bg-gray-800 py-1 shadow-lg">
                  <div className="border-b border-gray-700 px-3 py-2 text-sm text-gray-400">
                    {user.name || user.email}
                  </div>
                  {isSuperAdmin(user) && (
                    <NavLink
                      to="/admin"
                      className={({ isActive }) =>
                        `block px-3 py-2 text-sm ${isActive ? "text-indigo-400" : "text-gray-300 hover:bg-gray-700"}`
                      }
                    >
                      Admin
                    </NavLink>
                  )}
                  <button
                    onClick={logout}
                    className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl overflow-x-hidden px-4 py-3 sm:px-6 sm:py-4">
        {children}
      </main>
    </div>
  );
}

function AuthenticatedApp() {
  return (
    <AuthProvider>
      <Routes>
        {/* Full-screen routes — no app chrome */}
        <Route path="/songs/:id/perform" element={<PerformMode />} />
        <Route path="/setlists/:id/perform" element={<SetlistPerformMode />} />
        <Route path="/tuner" element={<Tuner />} />

        {/* Normal layout routes */}
        <Route path="*" element={
          <Layout>
            <Routes>
              <Route path="/" element={<SessionList />} />
              <Route path="/sessions/:id" element={<SessionDetail />} />
              <Route path="/songs" element={<SongCatalog />} />
              <Route path="/songs/:id" element={<SongHistory />} />
              <Route path="/setlists" element={<SetlistList />} />
              <Route path="/setlists/:id" element={<SetlistDetail />} />
              <Route path="/admin" element={<Admin />} />
            </Routes>
          </Layout>
        } />
      </Routes>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<AuthenticatedApp />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
