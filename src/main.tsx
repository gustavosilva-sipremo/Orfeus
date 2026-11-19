import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "@/App"
import { armWheelScroll } from "@/lib/wheel"
import "@/styles/theme.css"

armWheelScroll()

if (navigator.userAgent.includes("Windows")) {
  document.documentElement.dataset.platform = "windows"
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
