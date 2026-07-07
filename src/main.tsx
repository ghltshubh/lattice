import { createRoot } from "react-dom/client";
import App from "./ui/App";
import "./ui/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");
createRoot(root).render(<App />);
