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
      <header className={`hidden border-b border-gray-800 px-4 py-3 sm:block ${online ? "pt-[max(0.75rem,env(safe-area-inset-top))]" : ""}`}>
        <div className="mx-auto flex max-w-5xl items-center gap-x-8">
          <NavLink to="/" className="flex items-center gap-1.5 text-xl font-bold text-white hover:text-accent-300 transition">
            <span className="text-2xl" role="img" aria-label="jar">🫙</span>
            <span>JamJar</span>
          </NavLink>
          <nav className="flex flex-1 gap-4 text-sm">
            <NavLink
              to="/"
              className={() => {
                const active = location.pathname === "/" || location.pathname.startsWith("/sessions");
                return `py-2 px-3 ${active ? "text-accent-400" : "text-gray-400 hover:text-gray-200"}`;
              }}
            >
              Recordings
            </NavLink>
            <NavLink
              to="/songs"
              className={({ isActive }) =>
                `py-2 px-3 ${isActive ? "text-accent-400" : "text-gray-400 hover:text-gray-200"}`
              }
            >
              Songs
            </NavLink>
            <NavLink
              to="/setlists"
              className={({ isActive }) =>
                `py-2 px-3 ${isActive ? "text-accent-400" : "text-gray-400 hover:text-gray-200"}`
              }
            >
              Setlists
            </NavLink>
            <NavLink
              to="/tuner"
              className={({ isActive }) =>
                `py-2 px-3 ${isActive ? "text-accent-400" : "text-gray-400 hover:text-gray-200"}`
              }
            >
              Tuner
            </NavLink>
          </nav>
          {user && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-600 text-xs font-semibold text-white hover:bg-accent-500"
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
                        `block px-3 py-2 text-sm ${isActive ? "text-accent-400" : "text-gray-300 hover:bg-gray-700"}`
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
      <main className="mx-auto max-w-5xl overflow-x-hidden px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-20 sm:px-6 sm:pt-4 sm:pb-4">
        {children}
      </main>

      {/* Bottom tab bar for mobile */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-800 bg-gray-950 pb-[env(safe-area-inset-bottom)] sm:hidden">
        <div className="flex items-stretch justify-around">
          <NavLink to="/" className={() => {
            const active = location.pathname === "/" || location.pathname.startsWith("/sessions");
            return `flex flex-1 flex-col items-center gap-0.5 py-2 ${active ? "text-accent-400" : "text-gray-500"}`;
          }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
              <path d="M5.5 9.643a.75.75 0 00-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-1.5v-1.546A6.001 6.001 0 0016 10v-.357a.75.75 0 00-1.5 0V10a4.5 4.5 0 01-9 0v-.357z" />
            </svg>
            <span className="text-[10px] font-medium">Recs</span>
          </NavLink>
          <NavLink to="/songs" className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 py-2 ${isActive ? "text-accent-400" : "text-gray-500"}`
          }>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M17.721 1.599a.75.75 0 01.279.584v11.29a2.25 2.25 0 01-1.774 2.198l-2.041.442a2.216 2.216 0 01-.938-4.333l2.334-.506A.75.75 0 0016 10.545V6.388l-8.5 1.841v7.544a2.25 2.25 0 01-1.774 2.198l-2.041.442a2.216 2.216 0 11-.938-4.333l2.334-.506A.75.75 0 005.5 12.845V4.383a.75.75 0 01.592-.732l9.5-2.056a.75.75 0 01.629.004z" clipRule="evenodd" />
            </svg>
            <span className="text-[10px] font-medium">Songs</span>
          </NavLink>
          <NavLink to="/setlists" className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 py-2 ${isActive ? "text-accent-400" : "text-gray-500"}`
          }>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M6 4.75A.75.75 0 016.75 4h10.5a.75.75 0 010 1.5H6.75A.75.75 0 016 4.75zM6 10a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H6.75A.75.75 0 016 10zm0 5.25a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H6.75a.75.75 0 01-.75-.75zM1.99 4.75a1 1 0 011-1h.01a1 1 0 010 2h-.01a1 1 0 01-1-1zM1.99 10a1 1 0 011-1h.01a1 1 0 110 2h-.01a1 1 0 01-1-1zM1.99 15.25a1 1 0 011-1h.01a1 1 0 110 2h-.01a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
            <span className="text-[10px] font-medium">Setlists</span>
          </NavLink>
          <NavLink to="/tuner" className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 py-2 ${isActive ? "text-accent-400" : "text-gray-500"}`
          }>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 003 0v-13A1.5 1.5 0 0015.5 2zM10 6a1.5 1.5 0 00-1.5 1.5v5a1.5 1.5 0 003 0v-5A1.5 1.5 0 0010 6zM4.5 9A1.5 1.5 0 003 10.5v2a1.5 1.5 0 003 0v-2A1.5 1.5 0 004.5 9z" />
            </svg>
            <span className="text-[10px] font-medium">Tuner</span>
          </NavLink>
          {/* Account tab */}
          {user && (
            <div className="relative flex flex-1 flex-col items-center" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className={`flex flex-col items-center gap-0.5 py-2 ${menuOpen ? "text-accent-400" : "text-gray-500"}`}
                aria-label="Account menu"
              >
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-600 text-[9px] font-semibold text-white">
                  {(user.name || user.email).slice(0, 2).toUpperCase()}
                </div>
                <span className="text-[10px] font-medium">Account</span>
              </button>
              {menuOpen && (
                <div className="absolute bottom-full right-0 z-40 mb-2 w-48 rounded-lg border border-gray-700 bg-gray-800 py-1 shadow-lg">
                  <div className="border-b border-gray-700 px-3 py-2 text-sm text-gray-400">
                    {user.name || user.email}
                  </div>
                  {isSuperAdmin(user) && (
                    <NavLink
                      to="/admin"
                      className={({ isActive }) =>
                        `block px-3 py-2 text-sm ${isActive ? "text-accent-400" : "text-gray-300 hover:bg-gray-700"}`
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
      </nav>
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
