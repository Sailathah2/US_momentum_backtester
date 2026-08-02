/**
 * ==========================================================
 * LoginScreen.jsx -- the sign-in page
 * ==========================================================
 * Shown instead of the portal until someone signs in. It is deliberately
 * plain: a username, a password, and one honest error line.
 *
 * Note what this component does NOT do. It never stores the password, never
 * puts it in the address bar, and never sends it again after the initial
 * request - the server replies with a signed token and that is what travels
 * from then on.
 */
import React, { useState } from "react";
import { KeyRound, Loader2, LogIn, TrendingUp } from "lucide-react";

export default function LoginScreen({ onSignIn, backendOnline, notConfigured }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSignIn(username, password);
      // On success the parent swaps this screen out, so there is nothing
      // to do here. We deliberately do not clear the password on failure -
      // retyping a long password because of one typo is miserable.
    } catch (exception) {
      setError(exception.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brief-bg px-6 py-12">
      <div className="w-full max-w-sm">
        {/* -- Brand mark ------------------------------------------- */}
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-precision-600">
            <TrendingUp className="h-6 w-6 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-cream-50">
              Momentum Backtest Portal
            </h1>
            <p className="mt-1 text-2xs uppercase tracking-[0.18em] text-brief-muted">
              Tradewithsai &middot; sign in to continue
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="brief-card flex flex-col gap-4 p-6">
          <div>
            <label className="field-label" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              className="field mt-1.5"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              spellCheck={false}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="field mt-1.5"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-market-down/40 bg-market-down/10 px-3 py-2 text-2xs leading-relaxed text-cream-100">
              {error}
            </p>
          )}

          <button
            className="btn-primary !py-2.5"
            type="submit"
            disabled={busy || !backendOnline || !username || !password}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in…
              </>
            ) : (
              <>
                <LogIn className="h-4 w-4" />
                Sign in
              </>
            )}
          </button>

          {!backendOnline && (
            <p className="text-center text-2xs text-amber-400">
              The backend is not running. Start it with{" "}
              <span className="font-mono">python app.py</span> in the backend folder.
            </p>
          )}
        </form>

        {/* First run: tell them how to create the very first account,
            rather than leaving them staring at a form they cannot pass. */}
        {notConfigured && (
          <div className="mt-4 rounded-lg border border-brief-line bg-brief-surface p-4">
            <div className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 text-precision-400" />
              <p className="text-xs font-semibold text-cream-50">No accounts yet</p>
            </div>
            <p className="field-help !mt-1.5">
              Create one from the backend folder:
            </p>
            <code className="mt-2 block rounded bg-brief-bg px-2 py-1.5 font-mono text-2xs text-precision-300">
              python manage_users.py add yourname
            </code>
            <p className="field-help">
              It prints a strong password once. Until an account exists the portal
              stays open, so you cannot lock yourself out of a fresh install.
            </p>
          </div>
        )}

        <p className="mt-6 text-center text-2xs leading-relaxed text-brief-muted">
          For research and education only. Past performance in a backtest is not a
          promise of future results.
        </p>
      </div>
    </div>
  );
}
