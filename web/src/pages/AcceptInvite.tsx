import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { api, ApiError } from "../api";

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "expired">("loading");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      return;
    }
    api
      .validateInvite(token)
      .then((data) => {
        setEmail(data.email);
        setName(data.name);
        setStatus("ready");
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 410) {
          setStatus("expired");
        } else {
          setStatus("error");
        }
      });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 4) {
      setError("Password must be at least 4 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      await api.acceptInvite(token!, password);
      window.location.href = "/";
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <img src="/logo.png" alt="JamJar" className="h-20 w-20" />
          <h1 className="text-3xl font-bold text-white">JamJar</h1>
        </div>

        {status === "loading" && (
          <p className="text-center text-gray-400">Validating invite...</p>
        )}

        {status === "expired" && (
          <div className="rounded border border-yellow-800 bg-yellow-900/30 px-4 py-3 text-sm text-yellow-300">
            This invite link has expired or has already been used. Ask your admin to send a new one.
          </div>
        )}

        {status === "error" && (
          <div className="rounded border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
            Invalid invite link. Please check the URL or ask your admin for a new invite.
          </div>
        )}

        {status === "ready" && (
          <>
            <p className="mb-6 text-center text-sm text-gray-400">
              Welcome{name ? `, ${name}` : ""}! Set your password to get started.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded border border-red-800 bg-red-900/30 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm text-gray-400">Username</label>
                <input
                  type="text"
                  value={email}
                  disabled
                  className="w-full rounded border border-gray-700 bg-gray-800/50 px-3 py-2 text-gray-400"
                />
              </div>
              <div>
                <label htmlFor="password" className="mb-1 block text-sm text-gray-400">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="confirm" className="mb-1 block text-sm text-gray-400">
                  Confirm password
                </label>
                <input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded bg-accent-600 px-4 py-2 font-medium text-white transition hover:bg-accent-500 disabled:opacity-50"
              >
                {submitting ? "Setting up..." : "Set password & sign in"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
