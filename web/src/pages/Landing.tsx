import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router";
import { api } from "../api";

export default function Landing() {
  const [authChecked, setAuthChecked] = useState(false);
  const navigate = useNavigate();

  // Check auth with raw fetch to avoid fetchJson's 401→/login redirect
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" }).then((resp) => {
      if (resp.ok) {
        navigate("/sessions", { replace: true });
      } else {
        setAuthChecked(true);
      }
    }).catch(() => {
      setAuthChecked(true);
    });
  }, [navigate]);

  if (!authChecked) return null;

  return <LandingContent />;
}

function LandingContent() {
  const [email, setEmail] = useState("");
  const [bandName, setBandName] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.requestAccess(email, bandName, message);
      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-300">
      {/* Hero */}
      <section className="mx-auto max-w-2xl px-6 pb-16 pt-20 text-center">
        <h1 className="mb-5 flex items-center justify-center gap-3 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          <img src="/logo.png" alt="" className="h-12 w-12 sm:h-14 sm:w-14" /> JamJar
        </h1>
        <p className="mb-5 text-xl font-bold leading-snug tracking-tight text-white sm:text-2xl">
          Jam session recordings, song charts, setlists, and scheduling for your band
        </p>
        <p className="mb-9 text-base leading-relaxed text-gray-400 sm:text-lg">
          Upload rehearsal recordings and JamJar splits them into songs automatically. Tag takes, build a shared songbook, plan setlists, and schedule gigs — all in one place.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a href="#request-access" className="rounded-lg bg-accent-600 px-7 py-3 text-base font-semibold text-white hover:bg-accent-700 transition">Request Access</a>
          <Link to="/login" className="rounded-lg border border-gray-700 px-7 py-3 text-base text-gray-300 hover:border-gray-500 hover:text-white transition">Log In</Link>
          <a href="#features" className="rounded-lg border border-gray-700 px-7 py-3 text-base text-gray-300 hover:border-gray-500 hover:text-white transition">See what it does ↓</a>
        </div>
      </section>

      <div className="mx-12 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

      {/* Features */}
      <section id="features" className="mx-auto max-w-3xl px-6 py-16">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { icon: "🎙️", title: "Manage Recordings", desc: "Upload a full rehearsal recording. JamJar auto-splits it into individual takes. Tag each one, add notes, compare takes across sessions." },
            { icon: "📖", title: "Song Catalog", desc: "Charts, lyrics, notes, and every recorded take for each song in your repertoire." },
            { icon: "📋", title: "Setlists", desc: "Build ordered setlists from your catalog for gigs or rehearsals." },
            { icon: "📅", title: "Schedule", desc: "Create rehearsals and gigs with RSVP so everyone knows who's in." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
              <div className="mb-3 text-3xl">{f.icon}</div>
              <h3 className="mb-2 text-sm font-bold text-accent-400">{f.title}</h3>
              <p className="text-sm leading-relaxed text-gray-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mx-12 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

      {/* Request Access */}
      <section id="request-access" className="mx-auto max-w-md px-6 py-16 text-center">
        <h2 className="mb-2 text-2xl font-bold text-white">Request access</h2>
        <p className="mb-8 text-sm text-gray-400">Tell us about your band and we'll get you set up.</p>

        {submitted ? (
          <p className="text-lg font-medium text-accent-400">Thanks! We'll be in touch.</p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-left">
            <input
              type="email" required placeholder="Email address" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
            />
            <input
              type="text" required placeholder="Band / project name" value={bandName}
              onChange={(e) => setBandName(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
            />
            <textarea
              required placeholder="Tell us about your band..." value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-[80px] w-full resize-y rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit" disabled={loading}
              className="w-full rounded-lg bg-accent-600 py-3 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50 transition"
            >
              {loading ? "Sending..." : "Request Access"}
            </button>
          </form>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-6 text-center" />
    </div>
  );
}
