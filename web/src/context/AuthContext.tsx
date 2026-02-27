import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api";
import type { AuthUser } from "../api";
import Spinner from "../components/Spinner";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getMe()
      .then((u) => {
        setUser(u);
        // Cache user for offline access
        localStorage.setItem("cached-user", JSON.stringify(u));
      })
      .catch(() => {
        // Offline: use cached user so the app still renders (read-only)
        if (!navigator.onLine) {
          const cached = localStorage.getItem("cached-user");
          if (cached) {
            setUser(JSON.parse(cached));
            return;
          }
        }
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await api.logout();
    window.location.href = "/login";
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <Spinner size="lg" className="text-accent-400" />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
