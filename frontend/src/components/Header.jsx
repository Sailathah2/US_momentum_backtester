/**
 * ==========================================================
 * Header.jsx -- the masthead across the top of the page
 * ==========================================================
 * Shows the app name, a one-line description, and a small coloured dot that
 * tells you whether the Python backend is running.
 */
import React from "react";
import { Activity, LogOut, TrendingUp, User } from "lucide-react";

export default function Header({ online, universeSize, signedInAs, onSignOut }) {
  return (
    <header className="sticky top-0 z-30 border-b border-brief-line bg-brief-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-4 px-6 py-4">
        {/* -- Brand mark -------------------------------------------- */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-precision-600">
            <TrendingUp className="h-5 w-5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-lg font-extrabold leading-tight tracking-tight text-cream-50">
              Momentum Backtest Portal
            </h1>
            <p className="text-2xs uppercase tracking-[0.18em] text-brief-muted">
              Tradewithsai &middot; US &amp; Global Equities
            </p>
          </div>
        </div>

        <div className="flex-1" />

        {/* -- How many stocks are currently loaded ------------------- */}
        {universeSize > 0 && (
          <div className="hidden items-center gap-2 rounded-lg border border-brief-line bg-brief-surface px-3 py-2 sm:flex">
            <Activity className="h-4 w-4 text-precision-400" />
            <span className="font-mono text-sm font-semibold text-cream-50">
              {universeSize}
            </span>
            <span className="text-2xs uppercase tracking-wider text-brief-muted">
              symbols loaded
            </span>
          </div>
        )}

        {/* -- Backend status dot -------------------------------------
            Green = the Python server answered. Red = it is not running.
            The WORD next to the dot repeats the same information, so the
            status is never carried by colour alone. */}
        <div className="flex items-center gap-2 rounded-lg border border-brief-line bg-brief-surface px-3 py-2">
          <span
            className={`h-2 w-2 rounded-full ${
              online ? "bg-market-up" : "bg-market-down"
            }`}
          />
          <span className="text-2xs font-semibold uppercase tracking-wider text-brief-muted">
            {online ? "Backend online" : "Backend offline"}
          </span>
        </div>

        {/* -- Who is signed in, and the way out ----------------------- */}
        {signedInAs && (
          <div className="flex items-center gap-2 rounded-lg border border-brief-line bg-brief-surface px-3 py-2">
            <User className="h-3.5 w-3.5 text-precision-400" />
            <span className="font-mono text-2xs font-semibold text-cream-100">
              {signedInAs}
            </span>
            <button
              onClick={onSignOut}
              className="ml-1 text-brief-muted transition hover:text-cream-50 focus:outline-none focus:ring-2 focus:ring-precision-400 rounded"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
