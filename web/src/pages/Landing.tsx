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
      {/* Nav */}
      <nav className="sticky top-0 z-50 flex items-center justify-between border-b border-white/[0.06] bg-gray-950/95 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="JamJar" className="h-7 w-7" />
          <span className="text-lg font-bold text-white">JamJar</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="#features" className="hidden text-sm text-gray-400 hover:text-white transition sm:inline">Features</a>
          <a href="#request-access" className="hidden text-sm text-gray-400 hover:text-white transition sm:inline">Request Access</a>
          <Link to="/login" className="rounded-md bg-accent-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-accent-700 transition">Log In</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-2xl px-6 pb-16 pt-20 text-center">
        <img src="/logo.png" alt="JamJar" className="mx-auto mb-6 h-16 w-16" />
        <h1 className="mb-5 text-3xl font-extrabold leading-snug tracking-tight text-white sm:text-4xl">
          Jam session recordings, song charts, setlists, and scheduling for your band
        </h1>
        <p className="mb-9 text-base leading-relaxed text-gray-400 sm:text-lg">
          Upload rehearsal recordings and JamJar splits them into songs automatically. Tag takes, build a shared songbook, plan setlists, and schedule gigs — all in one place.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a href="#request-access" className="rounded-lg bg-accent-600 px-7 py-3 text-base font-semibold text-white hover:bg-accent-700 transition">Request Access</a>
          <a href="#features" className="rounded-lg border border-gray-700 px-7 py-3 text-base text-gray-300 hover:border-gray-500 hover:text-white transition">See what it does ↓</a>
        </div>
      </section>

      <div className="mx-12 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

      {/* Features */}
      <section id="features" className="mx-auto max-w-3xl px-6 py-16">
        <h2 className="mb-12 text-center text-2xl font-bold text-white">Four tools, one app</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { icon: "🎙️", title: "Jam Sessions", desc: "Upload a full rehearsal recording. JamJar auto-splits it into individual takes using energy-based detection. Tag each one, add notes, compare takes across sessions." },
            { icon: "📖", title: "Song Catalog", desc: "Your band's living songbook. Every song with its charts, lyrics, notes, and every recorded take. Pull it up on stage or in the practice room." },
            { icon: "📋", title: "Setlists", desc: "Drag songs from your catalog into ordered setlists. Use them for gigs, rehearsals, or planning what to work on next." },
            { icon: "📅", title: "Schedule", desc: "Create rehearsals and gigs. Band members RSVP so everyone knows who's in. No more group chat confusion." },
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

      {/* How it works */}
      <section className="mx-auto max-w-xl px-6 py-16">
        <h2 className="mb-12 text-center text-2xl font-bold text-white">From rehearsal to catalog in minutes</h2>
        {[
          { n: "1", title: "Record your jam", desc: "Hit record on your phone at the start of rehearsal. One long recording is fine." },
          { n: "2", title: "Upload & auto-split", desc: "JamJar detects the songs automatically and splits them into separate tracks." },
          { n: "3", title: "Tag, organize, share", desc: "Name each take, link it to a song, add notes. Share tracks with anyone via link." },
        ].map((step, i) => (
          <div key={step.n} className={`flex items-start gap-4${i < 2 ? " mb-8" : ""}`}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-600 text-sm font-bold text-white">{step.n}</div>
            <div>
              <h3 className="mb-1 text-sm font-semibold text-white">{step.title}</h3>
              <p className="text-sm text-gray-400">{step.desc}</p>
            </div>
          </div>
        ))}
      </section>

      <div className="mx-12 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

      {/* Request Access */}
      <section id="request-access" className="mx-auto max-w-md px-6 py-16 text-center">
        <h2 className="mb-2 text-2xl font-bold text-white">Get early access</h2>
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
      <footer className="border-t border-white/[0.06] py-6 text-center">
        <p className="text-xs text-gray-600">Built for bands that jam.</p>
      </footer>
    </div>
  );
}
