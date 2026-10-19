import Navigation from "@/components/Navigation";
import Hero from "@/components/sections/Hero";
import Manifesto from "@/components/sections/Manifesto";
import ExperimentGallery from "@/components/sections/ExperimentGallery";
import Closing from "@/components/sections/Closing";

export default function Home() {
  return (
    <main className="flex-1 relative z-20 overflow-hidden">
      <Navigation />
      <Hero />
      <Manifesto />
      <ExperimentGallery />
      <Closing />
      <div className="grain" aria-hidden="true" />
    </main>
  );
}
