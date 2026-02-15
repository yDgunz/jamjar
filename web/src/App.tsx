import { BrowserRouter, Routes, Route, NavLink } from "react-router";
import SessionList from "./pages/SessionList";
import SessionDetail from "./pages/SessionDetail";
import SongCatalog from "./pages/SongCatalog";
import SongHistory from "./pages/SongHistory";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <header className="border-b border-gray-800 px-6 py-4">
          <div className="mx-auto flex max-w-5xl items-center gap-8">
            <span className="text-xl font-bold text-white">
              Jam Session Processor
            </span>
            <nav className="flex gap-4 text-sm">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  isActive ? "text-indigo-400" : "text-gray-400 hover:text-gray-200"
                }
              >
                Sessions
              </NavLink>
              <NavLink
                to="/songs"
                className={({ isActive }) =>
                  isActive ? "text-indigo-400" : "text-gray-400 hover:text-gray-200"
                }
              >
                Songs
              </NavLink>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">
          <Routes>
            <Route path="/" element={<SessionList />} />
            <Route path="/sessions/:id" element={<SessionDetail />} />
            <Route path="/songs" element={<SongCatalog />} />
            <Route path="/songs/:id" element={<SongHistory />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
