import { BrowserRouter, Routes, Route, NavLink } from "react-router";
import ErrorBoundary from "./components/ErrorBoundary";
import SessionList from "./pages/SessionList";
import SessionDetail from "./pages/SessionDetail";
import SongCatalog from "./pages/SongCatalog";
import SongHistory from "./pages/SongHistory";
import PerformMode from "./pages/PerformMode";

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center gap-8">
          <span className="text-xl font-bold text-white">
            <span className="sm:hidden">Jam Sessions</span>
            <span className="hidden sm:inline">Jam Session Processor</span>
          </span>
          <nav className="flex gap-4 text-sm">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `py-2 px-3 ${isActive ? "text-indigo-400" : "text-gray-400 hover:text-gray-200"}`
              }
            >
              Sessions
            </NavLink>
            <NavLink
              to="/songs"
              className={({ isActive }) =>
                `py-2 px-3 ${isActive ? "text-indigo-400" : "text-gray-400 hover:text-gray-200"}`
              }
            >
              Songs
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
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
            </Routes>
          </Layout>
        } />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
