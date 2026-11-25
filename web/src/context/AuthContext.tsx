import { createContext, useContext, useEffect, useState } from "react";
import { api, clearUserClientState } from "../api";
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

const CACHED_USER_KEY = "cached-user";

function readCachedUser(): AuthUser | null {
  try {
    const cached = localStorage.getItem(CACHED_USER_KEY);
    return cached ? (JSON.parse(cached) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getMe()
      .then(async (u) => {
        // Someone else was signed in on this device before (every sign-in
        // reloads the page, so this runs after each one): drop what the
        // browser kept for them before anything renders.
        const previous = readCachedUser();
        if (previous && previous.id !== u.id) await clearUserClientState();
        setUser(u);
        // Cache user for offline access
        try {
          localStorage.setItem(CACHED_USER_KEY, JSON.stringify(u));
        } catch {
          /* storage unavailable */
        }
      })
      .catch(() => {
        // Offline: use cached user so the app still renders (read-only)
        if (!navigator.onLine) {
          const cached = readCachedUser();
          if (cached) {
            setUser(cached);
            return;
          }
        }
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      // Leave nothing of this person behind on the device
      try {
        localStorage.removeItem(CACHED_USER_KEY);
      } catch {
        /* storage unavailable */
      }
      await clearUserClientState();
    }
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
