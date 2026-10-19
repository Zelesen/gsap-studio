import { createRoot } from "react-dom/client";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import "./styles.css";

gsap.registerPlugin(ScrollTrigger);

function App() {
  useGSAP(() => {
    gsap.from("h1", {
      y: 50,
      opacity: 0,
      duration: 1,
      scrollTrigger: { trigger: "h1", start: "top center" },
    });
  }, []);
  return <h1 className="title" id="gate0-title">Gate 0: React + GSAP + ScrollTrigger</h1>;
}

createRoot(document.getElementById("root")!).render(<App />);