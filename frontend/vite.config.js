/**
 * ==========================================================
 * vite.config.js -- settings for the development web server
 * ==========================================================
 *
 * Vite is the tool that turns our React files into a website and serves it
 * while you work. Running `npm run dev` starts it.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173, // the website opens at http://localhost:5173
    open: true, // automatically opens your browser on start

    // "Proxy" means: anything the website asks for at /api/... is quietly
    // forwarded to the Python backend. This avoids browser security
    // complaints and means you never have to type a full URL.
    //
    // NOTE THE PORT: 5001, not 5000. The US Stock Data Downloader project
    // from earlier in this masterclass already listens on 5000, so this
    // project lives next door and both can run at the same time. This must
    // match the PORT value at the top of backend/app.py.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5001",
        changeOrigin: true,
      },
    },
  },
});
