import { useState, useRef, useEffect } from "react";
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from "react-router";
import { useBack, parentPath } from "./hooks/useBack";
import ErrorBoundary from "./components/ErrorBoundary";
import { api, isSuperAdmin, ApiError } from "./api";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { useOnline } from "./hooks/useOnline";
import { MiniPlayer, PlayerProvider, usePlayer } from "./context/PlayerContext";
import Login from "./pages/Login";
import SessionList from "./pages/SessionList";
import SessionDetail from "./pages/SessionDetail";
import DriveImport from "./pages/DriveImport";
import SongCatalog from "./pages/SongCatalog";
import SongHistory from "./pages/SongHistory";
import PerformMode from "./pages/PerformMode";
import SetlistList from "./pages/SetlistList";
import SetlistDetail from "./pages/SetlistDetail";
import SetlistPerformMode from "./pages/SetlistPerformMode";
import Tuner from "./pages/Tuner";
import Metronome from "./pages/Metronome";
import Practice from "./pages/Practice";
import Admin from "./pages/Admin";
import SharedLinks from "./pages/SharedLinks";
import PublicShare from "./share/PublicShare";
import AcceptInvite from "./pages/AcceptInvite";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Landing from "./pages/Landing";

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError("");
      setSuccess(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match");
      return;
    }
    setSubmitting(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to change password");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative mx-4 w-full max-w-sm rounded-lg border border-gray-700 bg-gray-900 px-6 py-5 shadow-xl">
        <h3 className="text-sm font-semibold text-white">Change Password</h3>
        {success ? (
          <p className="mt-3 text-sm text-green-400">Password changed successfully!</p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-3 space-y-3">
            <input
              ref={inputRef}
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
              required
            />
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
              required
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
              required
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded px-4 py-2 text-sm text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-accent-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-500 disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Change Password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const ICONS = {
  songs: (
    <path fillRule="evenodd" d="M17.721 1.599a.75.75 0 01.279.584v11.29a2.25 2.25 0 01-1.774 2.198l-2.041.442a2.216 2.216 0 01-.938-4.333l2.334-.506A.75.75 0 0016 10.545V6.388l-8.5 1.841v7.544a2.25 2.25 0 01-1.774 2.198l-2.041.442a2.216 2.216 0 11-.938-4.333l2.334-.506A.75.75 0 005.5 12.845V4.383a.75.75 0 01.592-.732l9.5-2.056a.75.75 0 01.629.004z" clipRule="evenodd" />
  ),
  recordings: (
    <>
      <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
      <path d="M5.5 9.643a.75.75 0 00-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-1.5v-1.546A6.001 6.001 0 0016 10v-.357a.75.75 0 00-1.5 0V10a4.5 4.5 0 01-9 0v-.357z" />
    </>
  ),
  setlists: (
    <path fillRule="evenodd" d="M6 4.75A.75.75 0 016.75 4h10.5a.75.75 0 010 1.5H6.75A.75.75 0 016 4.75zM6 10a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H6.75A.75.75 0 016 10zm0 5.25a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H6.75a.75.75 0 01-.75-.75zM1.99 4.75a1 1 0 011-1h.01a1 1 0 010 2h-.01a1 1 0 01-1-1zM1.99 10a1 1 0 011-1h.01a1 1 0 110 2h-.01a1 1 0 01-1-1zM1.99 15.25a1 1 0 011-1h.01a1 1 0 110 2h-.01a1 1 0 01-1-1z" clipRule="evenodd" />
  ),
  more: (
    <path d="M3 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM8.5 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM15.5 8.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
  ),
};

const NAV_ITEMS: { to: string; label: string; icon: keyof typeof ICONS }[] = [
  { to: "/songs", label: "Songs", icon: "songs" },
  { to: "/sessions", label: "Recordings", icon: "recordings" },
  { to: "/setlists", label: "Setlists", icon: "setlists" },
];

function NavIcon({ name, className = "h-6 w-6" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      {ICONS[name]}
    </svg>
  );
}

/** Menu contents shared by the desktop dropdown and the mobile "More" sheet. */
function MoreMenu({ onChangePassword }: { onChangePassword: () => void }) {
  const { user, logout } = useAuth();
  const row = "flex w-full items-center px-4 py-3 text-left text-[17px] text-gray-100 transition active:bg-white/5 sm:py-2 sm:text-sm sm:hover:bg-white/5";
  return (
    <>
      <div className="px-4 pb-2 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Tools</div>
      <NavLink to="/tuner" className={row}>Tuner</NavLink>
      <NavLink to="/metronome" className={row}>Metronome</NavLink>
      <NavLink to="/practice" className={row}>Practice</NavLink>
      <div className="mt-2 border-t border-white/[0.07] px-4 pb-2 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {user?.name || user?.email}
      </div>
      <NavLink to="/shares" className={row}>Shared links</NavLink>
      {user && isSuperAdmin(user) && <NavLink to="/admin" className={row}>Admin</NavLink>}
      <button onClick={onChangePassword} className={row}>Change password</button>
      <button onClick={logout} className={`${row} text-red-400`}>Sign out</button>
    </>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { item: playerItem } = usePlayer();
  const online = useOnline();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const desktopMoreRef = useRef<HTMLDivElement>(null);

  const isActive = (to: string) => location.pathname.startsWith(to);
  // Detail pages get a Back button in the bottom bar (no top breadcrumb on phones)
  const parent = parentPath(location.pathname);
  const goBack = useBack(parent ?? "/songs");
  const moreActive = ["/tuner", "/metronome", "/practice", "/shares", "/admin"].some((p) => location.pathname.startsWith(p));

  // Close the menu on navigation
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  // Desktop dropdown: close on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (window.innerWidth >= 640 && !desktopMoreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  const openPassword = () => { setMoreOpen(false); setPwModalOpen(true); };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {!online && (
        <div className="bg-yellow-600/90 px-4 pt-[env(safe-area-inset-top)] text-center text-sm font-medium text-white">
          <div className="py-1.5">Offline — showing cached data</div>
        </div>
      )}
      <header className={`hidden border-b border-white/[0.07] px-4 py-2.5 sm:block ${online ? "pt-[max(0.625rem,var(--safe-top))]" : ""}`}>
        <div className="mx-auto flex max-w-3xl items-center gap-x-6">
          <NavLink to="/songs" className="flex items-center gap-1.5 text-lg font-bold text-white">
            <img src="/logo.png" alt="" className="h-7 w-7" />
            <span>JamJar</span>
          </NavLink>
          <nav className="flex flex-1 gap-1 text-sm">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={`rounded-full px-3 py-1.5 transition ${isActive(item.to) ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          {user && (
            <div className="relative" ref={desktopMoreRef}>
              <button
                onClick={() => setMoreOpen(!moreOpen)}
                className={`rounded-full px-3 py-1.5 text-sm transition ${moreActive || moreOpen ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"}`}
              >
                More
              </button>
              {moreOpen && (
                <div className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-gray-900 pb-1 shadow-2xl">
                  <MoreMenu onChangePassword={openPassword} />
                </div>
              )}
            </div>
          )}
        </div>
      </header>
      {/* Home-screen app on iPhone: the status bar is translucent, so give it an opaque
          backdrop that scrolling content slides under instead of colliding with the
          clock and camera. Zero height wherever there is no top inset. */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[var(--safe-top)] bg-gray-950 sm:hidden" />
      <main className={`mx-auto max-w-3xl overflow-x-hidden px-4 pt-[calc(var(--safe-top)+0.25rem)] ${playerItem ? "pb-[calc(10rem+env(safe-area-inset-bottom))] sm:pb-28" : "pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-8"} sm:px-6 sm:pt-6`}>
        {children}
      </main>

      <MiniPlayer />

      {/* Bottom tab bar for mobile */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/[0.07] bg-gray-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg sm:hidden">
        <div className="flex items-stretch justify-around">
          {parent && (
            <button
              onClick={goBack}
              className="flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-gray-300 active:text-white"
              aria-label="Back"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6">
                <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
              </svg>
              <span className="text-[11px] font-medium">Back</span>
            </button>
          )}
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={`flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 ${isActive(item.to) ? "text-accent-400" : "text-gray-500"}`}
            >
              <NavIcon name={item.icon} />
              <span className="text-[11px] font-medium">{item.label}</span>
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            className={`flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 ${moreActive ? "text-accent-400" : "text-gray-500"}`}
          >
            <NavIcon name="more" />
            <span className="text-[11px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* Mobile "More" bottom sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMoreOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-gray-900 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-700" />
            <MoreMenu onChangePassword={openPassword} />
          </div>
        </div>
      )}
      <ChangePasswordModal open={pwModalOpen} onClose={() => setPwModalOpen(false)} />
    </div>
  );
}

function AuthenticatedApp() {
  return (
    <AuthProvider>
      <PlayerProvider>
      <Routes>
        {/* Full-screen routes — no app chrome */}
        <Route path="/songs/:id/perform" element={<PerformMode />} />
        <Route path="/setlists/:id/perform" element={<SetlistPerformMode />} />
        <Route path="/tuner" element={<Tuner />} />
        <Route path="/metronome" element={<Metronome />} />
        <Route path="/practice" element={<Practice />} />

        {/* Normal layout routes */}
        <Route path="*" element={
          <Layout>
            <Routes>
              <Route path="/sessions" element={<SessionList />} />
              <Route path="/sessions/:id" element={<SessionDetail />} />
              <Route path="/import/drive" element={<DriveImport />} />
              <Route path="/songs" element={<SongCatalog />} />
              <Route path="/songs/:id" element={<SongHistory />} />
              <Route path="/setlists" element={<SetlistList />} />
              <Route path="/setlists/:id" element={<SetlistDetail />} />
              <Route path="/shares" element={<SharedLinks />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<Navigate to="/songs" replace />} />
            </Routes>
          </Layout>
        } />
      </Routes>
      </PlayerProvider>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />
          <Route path="/invite/:token" element={<AcceptInvite />} />
          <Route path="/share/:token" element={<PublicShare />} />
          <Route path="/share/:token/songs/:songId" element={<PublicShare />} />
          <Route path="*" element={<AuthenticatedApp />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
