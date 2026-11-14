import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "./index.css";
import { ChapterShell } from "./ChapterShell";
import { Kitchen } from "./Kitchen";
import { chapters } from "./chapters";
import { StoryProvider } from "./store";

function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return hash === "#/kitchen" ? <Kitchen /> : <ChapterShell chapters={chapters} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <StoryProvider>
        <App />
      </StoryProvider>
    </MotionConfig>
  </StrictMode>,
);
