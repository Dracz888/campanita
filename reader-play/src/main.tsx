import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "./store/settingsContext";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);
