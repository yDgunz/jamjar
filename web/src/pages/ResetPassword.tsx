import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError } from "../api";

export default function ResetPassword() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "expired">("loading");
  const [email, setEmail] = useState("");
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
      .validateResetToken(token)
      .then((data) => {
        setEmail(data.email);
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
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      await api.resetPassword(token!, password);
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
          <p className="text-center text-gray-400">Validating reset link...</p>
        )}

        {status === "expired" && (
          <div className="space-y-4">
            <div className="rounded border border-yellow-800 bg-yellow-900/30 px-4 py-3 text-sm text-yellow-300">
              This reset link has expired or has already been used.
            </div>
            <div className="text-center">
              <Link
                to="/forgot-password"
                className="text-sm text-gray-400 hover:text-gray-200 transition"
              >
                Request a new reset link
              </Link>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-4">
            <div className="rounded border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
              Invalid reset link. Please check the URL or request a new one.
            </div>
            <div className="text-center">
              <Link
                to="/forgot-password"
                className="text-sm text-gray-400 hover:text-gray-200 transition"
              >
                Request a new reset link
              </Link>
            </div>
          </div>
        )}

        {status === "ready" && (
          <>
            <p className="mb-6 text-center text-sm text-gray-400">
              Set a new password for {email}.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded border border-red-800 bg-red-900/30 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}
              <div>
                <label htmlFor="password" className="mb-1 block text-sm text-gray-400">
                  New password
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
                {submitting ? "Resetting..." : "Reset password & sign in"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
