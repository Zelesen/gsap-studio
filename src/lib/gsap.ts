import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Register ScrollTrigger explicitly before animations use it.
gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };
