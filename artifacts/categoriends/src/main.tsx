import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Apply saved theme synchronously before first render to avoid flash
const savedTheme = (localStorage.getItem("categoriends_theme") ?? "dark") as "dark" | "light";
document.documentElement.classList.toggle("dark", savedTheme === "dark");
document.documentElement.classList.toggle("light", savedTheme === "light");

createRoot(document.getElementById("root")!).render(<App />);
