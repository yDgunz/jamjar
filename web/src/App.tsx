import { BrowserRouter, Routes, Route, NavLink } from "react-router";
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
import Admin from "./pages/Admin";

function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const online = useOnline();

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
          <nav className="flex flex-1 gap-1 text-sm sm:gap-4">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `py-2 px-2 sm:px-3 ${isActive ? "text-indigo-400" : "text-gray-400 hover:text-gray-200"}`
              }
            >
              Recordings
            </NavLink>
            <NavLink
              to="/songs"
              className={({ isActive }) =>
                `py-2 px-2 sm:px-3 ${isActive ? "text-indigo-400" : "text-gray-400 hover:text-gray-200"}`
              }
            >
              Songs
            </NavLink>
            {isSuperAdmin(user) && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `py-2 px-2 sm:px-3 ${isActive ? "text-indigo-400" : "text-gray-400 hover:text-gray-200"}`
                }
              >
                Admin
              </NavLink>
            )}
          </nav>
          {user && (
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden text-gray-400 sm:inline">{user.name || user.email}</span>
              <button
                onClick={logout}
                className="text-gray-500 transition hover:text-gray-300"
              >
                Sign out
              </button>
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
        {/* Full-screen route — no app chrome */}
        <Route path="/songs/:id/perform" element={<PerformMode />} />

        {/* Normal layout routes */}
        <Route path="*" element={
          <Layout>
            <Routes>
              <Route path="/" element={<SessionList />} />
              <Route path="/sessions/:id" element={<SessionDetail />} />
              <Route path="/songs" element={<SongCatalog />} />
              <Route path="/songs/:id" element={<SongHistory />} />
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
