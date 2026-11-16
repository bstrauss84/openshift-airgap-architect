/**
 * OpenShift Airgap Architect - Frontend Application Entry Point
 *
 * React application bootstrapping and root rendering.
 * Mounts the App component with StrictMode enabled.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { installTextDropCopyPolicy } from "./dragDropCopyPolicy.js";
import "./styles.css";

/* Text dropped into a form field must never be cut from the application it
   came from. Installed once at the document so every text input is covered,
   including ones not written yet. File-drop zones are untouched.
   See src/dragDropCopyPolicy.js for what this can and cannot influence. */
installTextDropCopyPolicy(document);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
