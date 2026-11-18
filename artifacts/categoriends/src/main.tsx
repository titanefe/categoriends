import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./index.css";

// Apply saved theme synchronously before first render to avoid flash
const savedTheme = (localStorage.getItem("categoriends_theme") ?? "dark") as "dark" | "light";
document.documentElement.classList.toggle("dark", savedTheme === "dark");
document.documentElement.classList.toggle("light", savedTheme === "light");

createRoot(document.getElementById("root")!).render(<App />);
