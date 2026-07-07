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
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
