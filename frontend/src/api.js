/**
 * ==========================================================
 * api.js -- every conversation with the Python backend
 * ==========================================================
 *
 * The React components never talk to the server directly. They call the
 * simple functions below, which keeps all the networking code in one place
 * and means error messages are worded consistently everywhere.
 *
 * All the addresses start with "/api". Vite quietly forwards those to the
 * Python server on port 5000 (see vite.config.js), so nothing here needs to
 * know a port number.
 */
import axios from "axios";

// A pre-configured messenger. 10 minutes is generous, but scanning a folder
// of several hundred CSV files genuinely can take a couple of minutes.
// WHERE THE BACKEND LIVES
// -----------------------
// Locally this is just "/api", and Vite quietly forwards those calls to the
// Python server on port 5001 (see vite.config.js).
//
// When the website is hosted somewhere the Python server is NOT - on Vercel,
// say - there is no proxy to do that forwarding, so the full address of the
// backend has to be baked in at build time via VITE_API_BASE. See
// DEPLOYMENT.md.
const API_BASE = import.meta.env.VITE_API_BASE
  ? `${String(import.meta.env.VITE_API_BASE).replace(/\/+$/, "")}/api`
  : "/api";

const http = axios.create({
  baseURL: API_BASE,
  timeout: 600000,
});

// ----------------------------------------------------------------------
// STAYING SIGNED IN
// ----------------------------------------------------------------------
// The server gives us a signed token after a correct password. We keep it
// in localStorage so a page refresh does not sign you out, and attach it to
// every request. The PASSWORD is never stored - only this token, which
// expires on its own and can be revoked by changing the server's secret.
const TOKEN_KEY = "momentum_portal_token";

export function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // private browsing modes can forbid localStorage
  }
}

export function setToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing we can do; the session just will not survive a refresh */
  }
}

// Attach the token to every outgoing request.
http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// When the server says "your token is stale", drop it and tell the app to
// show the login screen again. Registered by App.jsx on start-up.
let onSessionExpired = () => {};
export function setSessionExpiredHandler(handler) {
  onSessionExpired = handler;
}

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      setToken(null);
      onSessionExpired();
    }
    return Promise.reject(error);
  }
);

/** Exchange a username and password for a token. */
export async function signIn(username, password) {
  try {
    const { data } = await http.post("/login", { username, password });
    setToken(data.token);
    return data;
  } catch (error) {
    // A 401 here is a wrong password, not an expired session - show the
    // server's message rather than bouncing the user around.
    throw new Error(error.response?.data?.error || readableError(error));
  }
}

/** Sign out and forget the token. */
export async function signOut() {
  try {
    await http.post("/logout", {});
  } catch {
    /* signing out locally matters more than telling the server */
  }
  setToken(null);
}

/**
 * Turn any failure into a short sentence a non-technical user can act on.
 */
function readableError(error) {
  // The server answered, and politely told us what was wrong.
  if (error.response?.data?.error) return error.response.data.error;

  // The server never answered at all - almost always means it isn't running.
  if (error.code === "ERR_NETWORK" || !error.response) {
    return (
      "Could not reach the Python backend. Open a terminal, go to the " +
      "backend folder and run:  python app.py"
    );
  }

  if (error.code === "ECONNABORTED") {
    return "That took too long and timed out. Try scanning a smaller folder.";
  }

  return error.message || "Something went wrong.";
}

/**
 * Is OUR Python server running? Used for the status dot in the header.
 *
 * It is not enough to check that *something* answered. Other projects in this
 * masterclass also run a Flask server with an /api/health address, so if one
 * of those is on our port we would show a happy green light and then fail on
 * every real request with a confusing "that API address does not exist".
 *
 * So we check the `service_id` the backend reports and return one of three
 * answers: online, offline, or "wrong server on this port".
 */
export async function checkHealth() {
  try {
    const { data } = await http.get("/health");

    if (data?.service_id !== "momentum-backtest-portal") {
      return {
        online: false,
        wrongService: true,
        info: data,
        message:
          `Port 5001 is answering, but it is running "${data?.service || "another app"}" ` +
          `instead of the Momentum Backtest Portal. Stop that program, then start ` +
          `this project's backend with:  python app.py`,
      };
    }

    return {
      online: true,
      wrongService: false,
      info: data,
      message: null,
      // Does this server want a login, and has anyone been set up yet?
      authRequired: Boolean(data.auth_required),
      authConfigured: Boolean(data.auth_configured),
      signedInAs: data.signed_in_as || null,
    };
  } catch {
    return {
      online: false, wrongService: false, info: null, message: null,
      authRequired: false, authConfigured: false, signedInAs: null,
    };
  }
}

/**
 * Send CSV files the user dragged onto the page.
 * Pass an existing sessionId to ADD files to what is already loaded.
 */
export async function uploadFiles(fileList, sessionId = null) {
  const form = new FormData();
  Array.from(fileList).forEach((file) => form.append("files", file));
  if (sessionId) form.append("session_id", sessionId);

  try {
    const { data } = await http.post("/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  } catch (error) {
    throw new Error(readableError(error));
  }
}

/**
 * Read the symbol list out of an Excel file WITHOUT downloading anything,
 * so the user can check the right column was found before a long job.
 */
export async function previewSymbols(excelPath, folder, column) {
  try {
    const { data } = await http.post("/backfill/preview", {
      excel_path: excelPath,
      folder,
      column: column || null,
    });
    return data;
  } catch (error) {
    throw new Error(readableError(error));
  }
}

/** Start bringing every symbol's CSV up to yesterday's close. */
export async function startBackfill(excelPath, folder, options = {}) {
  try {
    const { data } = await http.post("/backfill/start", {
      excel_path: excelPath,
      folder,
      column: options.column || null,
      history_years: options.historyYears || 5,
    });
    return data;
  } catch (error) {
    throw new Error(readableError(error));
  }
}

/** How is the update going? Polled while it runs. */
export async function backfillStatus(jobId) {
  try {
    const { data } = await http.get(`/backfill/status/${jobId}`);
    return data.status;
  } catch (error) {
    throw new Error(readableError(error));
  }
}

/** Stop the update after the symbol currently in flight. */
export async function cancelBackfill(jobId) {
  try {
    await http.post(`/backfill/cancel/${jobId}`, {});
    return true;
  } catch (error) {
    throw new Error(readableError(error));
  }
}

/** The full stock ranking exactly as it stood on one historical date. */
export async function checkRank(payload) {
  try {
    const { data } = await http.post("/rank-check", payload);
    return data;
  } catch (error) {
    throw new Error(readableError(error));
  }
}

/** Ask the server to read every CSV inside a folder on this computer. */
export async function scanFolder(folder) {
  try {
    const { data } = await http.post("/scan-folder", { folder });
    return data;
  } catch (error) {
    throw new Error(readableError(error));
  }
}

/** Run the momentum backtest with the user's chosen settings. */
export async function runBacktest(payload) {
  try {
    const { data } = await http.post("/backtest", payload);
    return data;
  } catch (error) {
    throw new Error(readableError(error));
  }
}

/**
 * Run the momentum strategy twice - with the macro regime filter and
 * without it - and get both results back for side-by-side comparison.
 *
 * Takes everything runBacktest takes, plus: regime_mode, regime_index,
 * ema_period, atr_period, st_multiplier.
 */
export async function runRegimeAnalysis(payload) {
  try {
    const { data } = await http.post("/regime-analysis", payload);
    return data;
  } catch (error) {
    throw new Error(readableError(error));
  }
}

/**
 * Download the WHOLE run as one file with a sheet per table.
 *
 * `format` is "xlsx" for a real Excel workbook (one tab per sheet), or
 * "csv" for a ZIP holding one .csv per sheet - a single CSV file cannot
 * hold multiple sheets, so a folder of them is the honest equivalent.
 */
export async function downloadReport(sessionId, format = "xlsx") {
  try {
    const response = await http.post(
      "/export-report",
      { session_id: sessionId, format },
      { responseType: "blob" }
    );
    saveBlob(response, `momentum_report.${format === "csv" ? "zip" : "xlsx"}`);
    return true;
  } catch (error) {
    throw new Error(await blobError(error));
  }
}

/**
 * Turn a downloaded blob into a file on the user's computer, using the
 * filename the server suggested when it sent one.
 */
function saveBlob(response, fallbackName) {
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href = url;

  const disposition = response.headers["content-disposition"] || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  link.download = match ? match[1] : fallbackName;

  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * A failed file download hides its error message INSIDE the blob, so we
 * have to read the blob back out to find out what actually went wrong.
 */
async function blobError(error) {
  if (error.response?.data instanceof Blob) {
    try {
      const parsed = JSON.parse(await error.response.data.text());
      if (parsed.error) return parsed.error;
    } catch {
      /* the blob was not JSON after all - fall through */
    }
  }
  return readableError(error);
}

/**
 * Download one of the result tables as a CSV file.
 * `kind` is "trades", "rebalances", "timeseries" or "monthly".
 */
export async function exportCsv(sessionId, kind) {
  try {
    const response = await http.post(
      "/export",
      { session_id: sessionId, kind },
      { responseType: "blob" }
    );

    // Turn the received file into a download by creating a temporary link
    // and clicking it on the user's behalf.
    saveBlob(response, `momentum_${kind}.csv`);
    return true;
  } catch (error) {
    throw new Error(await blobError(error));
  }
}
