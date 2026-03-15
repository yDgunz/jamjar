import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.forgotPassword(email);
    } catch {
      // Ignore errors — always show success to prevent email enumeration
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <img src="/logo.png" alt="JamJar" className="h-20 w-20" />
          <h1 className="text-3xl font-bold text-white">JamJar</h1>
        </div>

        {submitted ? (
          <div className="space-y-4">
            <div className="rounded border border-green-800 bg-green-900/30 px-4 py-3 text-sm text-green-300">
              If an account exists with that email, we've sent a password reset link.
              Check your inbox.
            </div>
            <div className="text-center">
              <Link
                to="/login"
                className="text-sm text-gray-400 hover:text-gray-200 transition"
              >
                Back to sign in
              </Link>
            </div>
          </div>
        ) : (
          <>
            <p className="mb-6 text-center text-sm text-gray-400">
              Enter your email and we'll send you a link to reset your password.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1 block text-sm text-gray-400">
                  Email
                </label>
                <input
                  id="email"
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded bg-accent-600 px-4 py-2 font-medium text-white transition hover:bg-accent-500 disabled:opacity-50"
              >
                {loading ? "Sending..." : "Send reset link"}
              </button>
              <div className="text-center">
                <Link
                  to="/login"
                  className="text-sm text-gray-500 hover:text-gray-300 transition"
                >
                  Back to sign in
                </Link>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
