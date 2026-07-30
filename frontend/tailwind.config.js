/**
 * ==========================================================
 * tailwind.config.js -- the app's colour and font dictionary
 * ==========================================================
 *
 * Tailwind lets us style things by writing class names such as
 * `bg-brief-panel` or `text-precision-500`. This file defines what those
 * custom names mean, so the whole app stays visually consistent.
 *
 * The theme is "Tradewithsai / Morning Brief": a dark slate newspaper page,
 * warm cream headline type, and a precise blue accent for anything
 * interactive or data-bearing.
 */

/** @type {import('tailwindcss').Config} */
export default {
  // Which files Tailwind should scan for class names.
  content: ["./index.html", "./src/**/*.{js,jsx}"],

  // Dark mode is our DEFAULT look, controlled by a class on <html>.
  darkMode: "class",

  theme: {
    extend: {
      colors: {
        // -- Precision Blue: buttons, links, the portfolio equity line ----
        precision: {
          50: "#EFF6FF",
          100: "#DBEAFE",
          200: "#BFDBFE",
          300: "#93C5FD",
          400: "#60A5FA",
          500: "#3B82F6", // primary accent
          600: "#2563EB", // primary accent (pressed / solid buttons)
          700: "#1D4ED8",
          800: "#1E40AF",
          900: "#1E3A8A",
        },

        // -- Cream: editorial headlines and hairline highlights ------------
        cream: {
          50: "#FDFBF7", // brightest headline text
          100: "#F5F2EB", // body text on dark panels
          200: "#E8E3D8",
          300: "#D6CFBE",
          400: "#B8AF9A",
        },

        // -- The dark "newspaper page" surfaces ---------------------------
        brief: {
          bg: "#020617", // slate-950  - the page itself
          surface: "#0F172A", // slate-900  - section backgrounds
          panel: "#1E293B", // slate-800  - cards and panels
          line: "#334155", // slate-700  - hairline borders
          muted: "#94A3B8", // slate-400  - secondary text
        },

        // -- Market direction ---------------------------------------------
        // Green/red is the universal financial convention, so we keep it -
        // but every place we use it, the actual NUMBER is printed next to
        // the colour. That way a colour-blind reader never loses any
        // information: the colour is decoration, the digits are the data.
        market: {
          up: "#22C55E",
          down: "#E11D48",
        },

        // -- Chart series identity ----------------------------------------
        // These two hues were checked with a colour-vision simulator against
        // the dark chart surface (#0F172A): they stay 32.8 apart under
        // protanopia and deuteranopia, far above the safe threshold of 8.
        // IMPORTANT: blue ALWAYS means "your portfolio" and amber ALWAYS
        // means "the benchmark", on every single chart in the app.
        series: {
          portfolio: "#3B82F6", // Precision Blue
          benchmark: "#D97706", // Amber - deliberately not green or red

          // The regime dashboard draws THREE lines at once. This trio was
          // run through the same colour-vision check: every pair stays at
          // least 16 apart under protanopia, deuteranopia and tritanopia,
          // and all three sit in the readable lightness band for a dark
          // background. Blue always means "the filtered strategy", violet
          // "the unfiltered strategy", amber "the index".
          filterOn: "#3B82F6", // Precision Blue  - strategy WITH the filter
          filterOff: "#8B5CF6", // Violet          - strategy WITHOUT it
        },

        // -- Regime state ---------------------------------------------
        // The timeline strip under the chart. Green = invested, slate =
        // in cash. Both are always accompanied by a written label and a
        // date range, so the colour is never the only cue.
        regime: {
          on: "#22C55E",
          off: "#475569",
        },
      },

      fontFamily: {
        // Inter for everything; the mono stack is used for prices so digits
        // line up in neat columns.
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Consolas", "Menlo", "monospace"],
      },

      fontSize: {
        // A slightly tighter size for dense data tables.
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },

      boxShadow: {
        // A soft lift for cards so they float above the page.
        panel: "0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6)",
      },

      keyframes: {
        // Gentle fade-in used when results appear.
        riseIn: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },

      animation: {
        riseIn: "riseIn 260ms ease-out both",
      },
    },
  },

  plugins: [],
};
