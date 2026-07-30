/**
 * ==========================================================
 * main.jsx -- the starting point of the website
 * ==========================================================
 * This tiny file does one job: find the empty <div id="root"> in index.html
 * and draw the <App /> component inside it.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
