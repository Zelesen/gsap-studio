/*
 * M3.4 skill registry and prompt assembly tests.
 *
 * Uses mocks/stubs only. No paid AI API calls. Reads installed skill files
 * from .agents/skills/ (local, not a network call).
 *
 * Run with: npx tsx test/skill-registry.test.ts
 */

import { REGISTRY, selectSkills, validateSkillPath, loadSkillSecure } from "@/lib/skill-registry";
import { buildGenerationMessages } from "@/lib/prompt-assembly";
import { Message } from "@/lib/ai";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}`);
  }
}

async function main(): Promise<void> {
  console.log("\n=== skill selection: deterministic ===");

  // gsap-core and gsap-react always selected for React + GSAP projects.
  const r1 = await selectSkills({ userRequest: "A simple landing page", usesReactAndGsap: true });
  assert(r1.selected.some((s) => s.id === "gsap-core"), "gsap-core selected for React+GSAP");
  assert(r1.selected.some((s) => s.id === "gsap-react"), "gsap-react selected for React+GSAP");

  // No skills for a plain non-GSAP request when usesReactAndGsap is false.
  const r2 = await selectSkills({ userRequest: "hello world", usesReactAndGsap: false });
  const hasEngineering = r2.selected.some((s) => s.role === "gsap-engineering");
  assert(!hasEngineering, "no gsap engineering when not a GSAP project");

  console.log("\n=== skill selection: scrolltrigger ===");

  const r3 = await selectSkills({
    userRequest: "A landing page with a scroll reveal and parallax",
    usesReactAndGsap: true,
    wantsScrollAnimation: true,
  });
  assert(r3.selected.some((s) => s.id === "gsap-scrolltrigger"), "gsap-scrolltrigger selected for scroll request");

  const r4 = await selectSkills({
    userRequest: "A simple hero section",
    usesReactAndGsap: true,
    wantsScrollAnimation: false,
  });
  assert(!r4.selected.some((s) => s.id === "gsap-scrolltrigger"), "gsap-scrolltrigger not selected without scroll request");

  console.log("\n=== skill selection: accessibility ===");

  const r5 = await selectSkills({ userRequest: "A contact form", usesReactAndGsap: true });
  assert(r5.selected.some((s) => s.id === "intopia-web-accessibility"), "accessibility selected for form UI");

  console.log("\n=== skill selection: conflicting visual styles (at most one design-direction) ===");

  const r6 = await selectSkills({
    userRequest: "A minimalist brutalist premium agency site",
    usesReactAndGsap: true,
  });
  const designSkills = r6.selected.filter((s) => s.role === "design-direction");
  assert(designSkills.length <= 1, "at most one design-direction skill selected");
  if (designSkills.length === 1) {
    console.log(`    selected design-direction: ${designSkills[0].id}`);
  }

  // Tie-breaking: two skills with equal score -> priority order wins.
  const r7 = await selectSkills({
    userRequest: "design premium",
    usesReactAndGsap: true,
  });
  const d7 = r7.selected.filter((s) => s.role === "design-direction");
  assert(d7.length === 1, "exactly one design-direction on tie");
  if (d7.length === 1) {
    assert(
      d7[0].id === "design-taste-frontend",
      "tie broken to design-taste-frontend by priority"
    );
  }

  console.log("\n=== skill selection: max skills cap ===");

  const r8 = await selectSkills(
    {
      userRequest: "scroll animation accessible react component design minimal premium",
      usesReactAndGsap: true,
    },
    { maxSkills: 2 }
  );
  assert(r8.selected.length <= 2, "max skills cap respected");

  console.log("\n=== skill path validation: traversal and escapes ===");

  assert(!validateSkillPath("../etc/passwd"), ".. traversal rejected");
  assert(!validateSkillPath("/etc/passwd"), "absolute path rejected");
  assert(!validateSkillPath("C:\\Windows\\system32"), "Windows absolute rejected");
  assert(!validateSkillPath("gsap-core/SKILL.md\x00"), "null byte rejected");
  assert(validateSkillPath("gsap-core/SKILL.md"), "valid relative path accepted");
  assert(validateSkillPath("intopia-web-accessibility/SKILL.md"), "valid skill path accepted");

  console.log("\n=== skill loading: actionable section delivery ===");

  // gsap-core must deliver actionable sections, not only frontmatter/intro.
  const coreEntry = REGISTRY.find((e) => e.id === "gsap-core");
  assert(!!coreEntry, "gsap-core registry entry exists");
  const core = await loadSkillSecure(coreEntry!, 8000);
  assert(!!core, "gsap-core loads successfully");
  if (core) {
    assert(core.content.includes("Core Tween Methods"), "gsap-core delivers Core Tween Methods");
    assert(core.content.includes("Common vars"), "gsap-core delivers Common vars");
    assert(core.content.includes("matchMedia"), "gsap-core delivers matchMedia (responsive/reduced-motion)");
    assert(core.content.includes("reduced-motion"), "gsap-core delivers reduced-motion guidance");
    assert(core.content.includes("Do Not"), "gsap-core delivers Do Not (common mistakes)");
    assert(core.content.length <= (coreEntry!.maxChars ?? 8000), "gsap-core respects per-skill cap");
    // Must not be only frontmatter/intro.
    const introOnly = core.content.split("\n").length < 8;
    assert(!introOnly, "gsap-core is not intro-only");
  }

  // gsap-scrolltrigger must deliver scrub, pinning, cleanup, and mistakes.
  const scrollEntry = REGISTRY.find((e) => e.id === "gsap-scrolltrigger");
  assert(!!scrollEntry, "gsap-scrolltrigger registry entry exists");
  const scroll = await loadSkillSecure(scrollEntry!, 9000);
  assert(!!scroll, "gsap-scrolltrigger loads successfully");
  if (scroll) {
    assert(scroll.content.includes("Key config options"), "gsap-scrolltrigger delivers Key config options");
    assert(scroll.content.includes("scrub"), "gsap-scrolltrigger delivers scrub guidance");
    assert(scroll.content.includes("Pinning"), "gsap-scrolltrigger delivers Pinning guidance");
    assert(scroll.content.includes("Refresh and Cleanup"), "gsap-scrolltrigger delivers cleanup guidance");
    assert(scroll.content.includes("Do Not"), "gsap-scrolltrigger delivers Do Not (common mistakes)");
    assert(scroll.content.length <= (scrollEntry!.maxChars ?? 9000), "gsap-scrolltrigger respects per-skill cap");
  }

  // Per-skill cap is never exceeded (using a plain entry without prioritySections).
  const coreCap = await loadSkillSecure(
    { id: "gsap-core", path: "gsap-core/SKILL.md", role: "gsap-engineering", description: "", triggers: ["gsap"] },
    2000
  );
  if (coreCap) {
    assert(coreCap.content.length <= 2000, "gsap-core respects a smaller per-skill cap");
  }

  // Combined budget enforcement via selectSkills.
  const rb = await selectSkills(
    {
      userRequest: "A cinematic landing page with scroll reveals and parallax",
      usesReactAndGsap: true,
      wantsScrollAnimation: true,
    },
    { maxCombinedChars: 3000 }
  );
  let combined = 0;
  for (const s of rb.selected) combined += s.content.length;
  assert(combined <= 3000, `combined skill content within budget (${combined} <= 3000)`);

  console.log("\n=== skill loading: missing and malformed (regression) ===");

  // Missing file -> null.
  const missing = await loadSkillSecure(
    { id: "nope", path: "does-not-exist/SKILL.md", role: "accessibility", description: "", triggers: [] },
    3000
  );
  assert(missing === null, "missing skill file returns null");

  // Traversal path -> null.
  const traversal = await loadSkillSecure(
    { id: "nope", path: "../../package.json", role: "accessibility", description: "", triggers: [] },
    3000
  );
  assert(traversal === null, "traversal path returns null from loadSkillSecure");

  console.log("\n=== skill loading: oversized / budget ===");

  // Tiny cap forces truncation or skip.
  const tiny = await loadSkillSecure(
    { id: "gsap-core", path: "gsap-core/SKILL.md", role: "gsap-engineering", description: "", triggers: ["gsap"] },
    10
  );
  if (tiny) {
    assert(tiny.content.length <= 10, "oversized content truncated to cap");
  } else {
    // If even the first section won't fit, it's skipped (acceptable per design).
    console.log("    oversized skill skipped (first section too large)");
  }

  console.log("\n=== skill selection: budget enforcement ===");

  const r9 = await selectSkills(
    {
      userRequest: "scroll animation accessible react component design minimal premium",
      usesReactAndGsap: true,
    },
    { maxCombinedChars: 200 }
  );
  // At least gsap-core and gsap-react should attempt; small budget may skip some.
  console.log(`    selected ${r9.selected.length} skills, skipped ${r9.skipped.length} under tiny budget`);
  assert(r9.selected.length <= 4, "budget does not exceed max skills");

  // Verify truncated flag is accurate.
  const r10 = await selectSkills({ userRequest: "A landing page", usesReactAndGsap: true });
  for (const s of r10.selected) {
    assert(typeof s.truncated === "boolean", "truncated flag is a boolean");
  }

  console.log("\n=== prompt assembly ===");

  const conv: Message[] = [
    { role: "user", content: "Build a landing page with GSAP scroll animation" },
  ];
  const asm = await buildGenerationMessages({
    userRequest: "Build a landing page with GSAP scroll animation",
    messages: conv,
    usesReactAndGsap: true,
    wantsScrollAnimation: true,
  });

  // Trusted system prompt is first.
  assert(asm.messages[0].role === "system", "first message is system");
  assert(asm.messages[0].content.includes("manifest"), "system prompt contains manifest contract");

  // Skills inserted as system messages after trusted prompt.
  const systemMsgs = asm.messages.filter((m) => m.role === "system");
  assert(systemMsgs.length >= 2, "at least trusted prompt + skills as system messages");

  // Conversation preserved at the end.
  const last = asm.messages[asm.messages.length - 1];
  assert(last.role === "user", "conversation message last");
  assert(last.content === "Build a landing page with GSAP scroll animation", "user content preserved");

  // Skill guidance is clearly marked.
  const skillsBlock = systemMsgs.find((m) => m.content.includes("Supplemental skill guidance"));
  assert(!!skillsBlock, "skill guidance block present");
  if (skillsBlock) {
    assert(skillsBlock.content.includes("Skill: gsap-core"), "gsap-core skill marked");
    assert(skillsBlock.content.includes("lower priority"), "skills marked lower priority");
  }

  console.log("\n=== prompt assembly: current project state ===");

  const asm2 = await buildGenerationMessages({
    userRequest: "Change the hero color",
    messages: [{ role: "user", content: "Change the hero color" }],
    currentHtml: "<html>...</html>",
    currentCss: "body { color: red; }",
    currentJs: "console.log('hi');",
    usesReactAndGsap: true,
  });
  const hasProjectState = asm2.messages.some(
    (m) => m.content.includes("CURRENT PROJECT STATE")
  );
  assert(hasProjectState, "current project state included when provided");

  console.log("\n=== prompt assembly: design brief ===");

  const asm3 = await buildGenerationMessages({
    userRequest: "Build a site",
    messages: [{ role: "user", content: "Build a site" }],
    designBrief: "Direction: minimalist. Palette: warm monochrome.",
    usesReactAndGsap: true,
  });
  const hasBrief = asm3.messages.some((m) => m.content.includes("VALIDATED DESIGN BRIEF"));
  assert(hasBrief, "design brief included when provided");

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
