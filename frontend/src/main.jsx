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
import ReactDOM from "react-dom";
import App from "./App.jsx";
import "./styles.css";

// React 17 rendering (not React 18 createRoot)
ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById("root")
);
