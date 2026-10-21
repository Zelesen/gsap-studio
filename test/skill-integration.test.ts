/*
 * M3.4 Phase C — Integrated skill pipeline tests with mocked model response.
 *
 * Verifies the full message-assembly → selection → validation → compilation
 * path without calling any paid AI API. For each scenario:
 *   1. Builds messages via buildGenerationMessages (real skill loading).
 *   2. Asserts selected skill IDs and content inclusion.
 *   3. Asserts no conflicting visual-style skills.
 *   4. Submits a valid mock ProjectResult through validateProjectResult.
 *   5. Compiles the mock project through the real compiler.
 *
 * Run with: npx tsx test/skill-integration.test.ts
 */

import { buildGenerationMessages } from "@/lib/prompt-assembly";
import { selectSkills } from "@/lib/skill-registry";
import { validateProjectResult } from "@/lib/project";
import { compileProject } from "@/lib/compiler";
import { Message } from "@/lib/ai";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${name}${detail ? `  [${detail}]` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? `  [${detail}]` : ""}`);
  }
}

// A valid, compiler-compatible React + GSAP project used as a mock model response.
// All imports are from the approved allowlist.
const mockProject = {
  manifest: {
    name: "mock-site",
    version: "0.1.0",
    entry: "src/main.tsx",
    dependencies: {
      react: "19.0.0",
      "react-dom": "19.0.0",
      "react-dom/client": "19.0.0",
      "react/jsx-runtime": "19.0.0",
      gsap: "3.12.5",
      "gsap/ScrollTrigger": "3.12.5",
      "@gsap/react": "2.1.0",
    },
    framework: "react-ts",
  },
  files: [
    {
      path: "src/main.tsx",
      content: `import { createRoot } from "react-dom/client";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import "./styles.css";
gsap.registerPlugin(ScrollTrigger);
function App() {
  useGSAP(() => { gsap.from("h1", { y: 40, opacity: 0, duration: 1 }); }, []);
  return <h1 id="t">Mock</h1>;
}
createRoot(document.getElementById("root")!).render(<App />);`,
    },
    { path: "src/styles.css", content: "body { margin: 0; }" },
  ],
};

async function main(): Promise<void> {

  /* ── Scenario 1: cinematic landing page with scroll reveals and parallax ── */
  console.log("\n=== Scenario 1: cinematic landing page with scroll reveals and parallax ===");
  {
    const conv: Message[] = [
      { role: "user", content: "A cinematic landing page with scroll reveals and parallax" },
    ];
    const asm = await buildGenerationMessages({
      userRequest: "A cinematic landing page with scroll reveals and parallax",
      messages: conv,
      usesReactAndGsap: true,
      wantsScrollAnimation: true,
    });

    // Message order: trusted system prompt first, conversation last.
    assert(asm.messages[0].role === "system", "S1: first message is system (trusted prompt)");
    assert(asm.messages[0].content.includes("manifest"), "S1: trusted prompt contains manifest contract");
    const last = asm.messages[asm.messages.length - 1];
    assert(last.role === "user", "S1: conversation message last");
    assert(last.content === "A cinematic landing page with scroll reveals and parallax", "S1: user content preserved");

    // Skill selection checks.
    const sel = await selectSkills({
      userRequest: "A cinematic landing page with scroll reveals and parallax",
      usesReactAndGsap: true,
      wantsScrollAnimation: true,
    });
    const ids = sel.selected.map((s) => s.id);
    assert(ids.includes("gsap-core"), "S1: gsap-core selected");
    assert(ids.includes("gsap-react"), "S1: gsap-react selected");
    assert(ids.includes("gsap-scrolltrigger"), "S1: gsap-scrolltrigger selected for scroll");
    assert(ids.includes("intopia-web-accessibility"), "S1: accessibility selected");

    // At most one design-direction skill.
    const designSkills = sel.selected.filter((s) => s.role === "design-direction");
    assert(designSkills.length <= 1, "S1: at most one design-direction skill");

    // Skill content present in assembled messages.
    const skillGuidance = asm.messages
      .filter((m) => m.role === "system")
      .find((m) => m.content.includes("Supplemental skill guidance"));
    assert(!!skillGuidance, "S1: skill guidance block present");
      if (skillGuidance) {
        assert(skillGuidance.content.includes("Skill: gsap-core"), "S1: gsap-core content included");
        assert(skillGuidance.content.includes("Skill: gsap-scrolltrigger"), "S1: gsap-scrolltrigger content included");
        // Actionable GSAP guidance must be present in assembled messages.
        assert(skillGuidance.content.includes("Core Tween Methods"), "S1: gsap-core Core Tween Methods in messages");
        assert(skillGuidance.content.includes("matchMedia"), "S1: gsap-core matchMedia in messages");
        assert(skillGuidance.content.includes("scrub"), "S1: gsap-scrolltrigger scrub in messages");
        assert(skillGuidance.content.includes("Pinning"), "S1: gsap-scrolltrigger Pinning in messages");
        assert(
          skillGuidance.content.includes("lower priority"),
          "S1: skills marked lower priority"
        );
      // No conflicting design-direction skills in guidance.
      const designIdsInGuidance = designSkills.map((s) => `Skill: ${s.id}`);
      assert(designIdsInGuidance.length <= 1, "S1: no conflicting design skills in guidance");
    }

    // Mock model response validates and compiles.
    const vr = validateProjectResult(mockProject);
    assert(vr.ok, "S1: mock project validates");
    if (vr.ok) {
      const compiled = await compileProject({
        files: Object.fromEntries(vr.result.files.map((f) => [f.path, f.content])),
        entry: vr.result.manifest.entry,
      });
      assert(compiled.diagnostics.length === 0, "S1: mock project compiles", compiled.diagnostics.join("; "));
      assert(compiled.html.length > 0, "S1: produces HTML");
      assert(compiled.js.length > 0, "S1: produces JS");
    }
  }

  /* ── Scenario 2: minimalist editorial portfolio ── */
  console.log("\n=== Scenario 2: minimalist editorial portfolio ===");
  {
    const conv: Message[] = [
      { role: "user", content: "A minimalist editorial portfolio with bento grid" },
    ];
    const asm = await buildGenerationMessages({
      userRequest: "A minimalist editorial portfolio with bento grid",
      messages: conv,
      usesReactAndGsap: true,
      wantsScrollAnimation: false,
    });

    assert(asm.messages[0].role === "system", "S2: first message is system");
    const last = asm.messages[asm.messages.length - 1];
    assert(last.role === "user", "S2: conversation message last");

    const sel = await selectSkills({
      userRequest: "A minimalist editorial portfolio with bento grid",
      usesReactAndGsap: true,
      wantsScrollAnimation: false,
    });
    const ids = sel.selected.map((s) => s.id);
    assert(ids.includes("gsap-core"), "S2: gsap-core selected");
    assert(ids.includes("gsap-react"), "S2: gsap-react selected");
    assert(!ids.includes("gsap-scrolltrigger"), "S2: gsap-scrolltrigger not selected without scroll");

    // At most one design-direction skill.
    const designSkills = sel.selected.filter((s) => s.role === "design-direction");
    assert(designSkills.length <= 1, "S2: at most one design-direction skill");
    if (designSkills.length === 1) {
      assert(designSkills[0].id === "minimalist-ui", "S2: minimalist-ui selected for minimalist request");
    }

    // Skill guidance present and non-empty.
    const skillGuidance = asm.messages
      .filter((m) => m.role === "system")
      .find((m) => m.content.includes("Supplemental skill guidance"));
    assert(!!skillGuidance, "S2: skill guidance block present");
    if (skillGuidance) {
      assert(skillGuidance.content.includes("Skill: minimalist-ui"), "S2: minimalist-ui content included");
    }

    // Mock validates and compiles.
    const vr = validateProjectResult(mockProject);
    assert(vr.ok, "S2: mock project validates");
    if (vr.ok) {
      const compiled = await compileProject({
        files: Object.fromEntries(vr.result.files.map((f) => [f.path, f.content])),
        entry: vr.result.manifest.entry,
      });
      assert(compiled.diagnostics.length === 0, "S2: mock project compiles", compiled.diagnostics.join("; "));
    }
  }

  /* ── Scenario 3: business dashboard with accessible interactive components ── */
  console.log("\n=== Scenario 3: business dashboard with accessible interactive components ===");
  {
    const conv: Message[] = [
      { role: "user", content: "A business dashboard with accessible interactive components" },
    ];
    const asm = await buildGenerationMessages({
      userRequest: "A business dashboard with accessible interactive components",
      messages: conv,
      usesReactAndGsap: true,
      wantsScrollAnimation: false,
    });

    assert(asm.messages[0].role === "system", "S3: first message is system");
    const last = asm.messages[asm.messages.length - 1];
    assert(last.role === "user", "S3: conversation message last");

    const sel = await selectSkills({
      userRequest: "A business dashboard with accessible interactive components",
      usesReactAndGsap: true,
      wantsScrollAnimation: false,
    });
    const ids = sel.selected.map((s) => s.id);
    assert(ids.includes("gsap-core"), "S3: gsap-core selected");
    assert(ids.includes("gsap-react"), "S3: gsap-react selected");
    assert(ids.includes("intopia-web-accessibility"), "S3: accessibility selected for interactive components");

    // At most one design-direction skill.
    const designSkills = sel.selected.filter((s) => s.role === "design-direction");
    assert(designSkills.length <= 1, "S3: at most one design-direction skill");

    // Skill guidance includes accessibility content.
    const skillGuidance = asm.messages
      .filter((m) => m.role === "system")
      .find((m) => m.content.includes("Supplemental skill guidance"));
    assert(!!skillGuidance, "S3: skill guidance block present");
    if (skillGuidance) {
      assert(skillGuidance.content.includes("Skill: intopia-web-accessibility"), "S3: accessibility content included");
    }

    // Mock validates and compiles.
    const vr = validateProjectResult(mockProject);
    assert(vr.ok, "S3: mock project validates");
    if (vr.ok) {
      const compiled = await compileProject({
        files: Object.fromEntries(vr.result.files.map((f) => [f.path, f.content])),
        entry: vr.result.manifest.entry,
      });
      assert(compiled.diagnostics.length === 0, "S3: mock project compiles", compiled.diagnostics.join("; "));
    }
  }

  /* ── Scenario 4: simple non-GSAP React page ── */
  console.log("\n=== Scenario 4: simple non-GSAP React page ===");
  {
    const conv: Message[] = [
      { role: "user", content: "A simple React page with a heading" },
    ];
    const asm = await buildGenerationMessages({
      userRequest: "A simple React page with a heading",
      messages: conv,
      usesReactAndGsap: false,
      wantsScrollAnimation: false,
    });

    assert(asm.messages[0].role === "system", "S4: first message is system");
    const last = asm.messages[asm.messages.length - 1];
    assert(last.role === "user", "S4: conversation message last");

    const sel = await selectSkills({
      userRequest: "A simple React page with a heading",
      usesReactAndGsap: false,
      wantsScrollAnimation: false,
    });
    const ids = sel.selected.map((s) => s.id);
    assert(!ids.includes("gsap-core"), "S4: gsap-core not selected for non-GSAP page");
    assert(!ids.includes("gsap-react"), "S4: gsap-react not selected for non-GSAP page");

    // At most one design-direction skill.
    const designSkills = sel.selected.filter((s) => s.role === "design-direction");
    assert(designSkills.length <= 1, "S4: at most one design-direction skill");

    // Mock validates and compiles.
    const vr = validateProjectResult(mockProject);
    assert(vr.ok, "S4: mock project validates");
    if (vr.ok) {
      const compiled = await compileProject({
        files: Object.fromEntries(vr.result.files.map((f) => [f.path, f.content])),
        entry: vr.result.manifest.entry,
      });
      assert(compiled.diagnostics.length === 0, "S4: mock project compiles", compiled.diagnostics.join("; "));
    }
  }

  /* ── Follow-up: current project state preserved ── */
  console.log("\n=== Follow-up: current project state preserved ===");
  {
    const asm = await buildGenerationMessages({
      userRequest: "Change the hero color to blue",
      messages: [{ role: "user", content: "Change the hero color to blue" }],
      currentHtml: "<html><body><div id=\"root\"></div></body></html>",
      currentCss: "body { color: red; }",
      currentJs: "console.log('existing');",
      usesReactAndGsap: true,
    });
    const hasProjectState = asm.messages.some(
      (m) => m.content.includes("CURRENT PROJECT STATE")
    );
    assert(hasProjectState, "Follow-up: current project state included");
    const last = asm.messages[asm.messages.length - 1];
    assert(last.role === "user", "Follow-up: conversation message last");
    assert(last.content === "Change the hero color to blue", "Follow-up: user content preserved");
  }

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
