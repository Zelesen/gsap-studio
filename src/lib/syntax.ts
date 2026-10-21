/*
 * Lightweight syntax highlighting for source files shown in the Studio
 * code workspace.
 *
 * Deliberately small and dependency-free: it escapes the source, then wraps
 * tokens in `<span>` elements keyed by role. The roles map to CSS custom
 * properties in `globals.css` (`--syntax-*`). No grammar is parsed — this is
 * pattern-based highlighting for the file types the generator produces
 * (TSX/TS/JS/CSS/HTML/JSON), good enough to make a file look like code
 * without pulling in a heavy editor or highlighter.
 */

export type SyntaxLanguage =
  | "tsx"
  | "ts"
  | "js"
  | "jsx"
  | "css"
  | "html"
  | "json"
  | "plain";

export function languageForPath(path: string): SyntaxLanguage {
  const name = path.toLowerCase();
  if (name.endsWith(".tsx")) return "tsx";
  if (name.endsWith(".ts")) return "ts";
  if (name.endsWith(".jsx")) return "jsx";
  if (name.endsWith(".js")) return "js";
  if (name.endsWith(".css")) return "css";
  if (name.endsWith(".html") || name.endsWith(".htm")) return "html";
  if (name.endsWith(".json")) return "json";
  return "plain";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Wrap an escaped chunk in a role span, unless it is already tagged. */
function span(role: string, html: string): string {
  return `<span class="syntax--${role}">${html}</span>`;
}

/* ───────── JavaScript / TypeScript ───────── */

const JS_KEYWORDS = new Set([
  "break","case","catch","class","const","continue","debugger","default","delete",
  "do","else","enum","export","extends","finally","for","function","if","import",
  "in","instanceof","let","new","null","return","super","switch","this","throw",
  "try","typeof","var","void","while","with","yield","async","await","of","static",
  "abstract","implements","interface","private","protected","public","readonly",
  "true","false","undefined","NaN","Infinity","arguments","eval","void",
]);

const JS_TYPES = new Set([
  "string","number","boolean","symbol","bigint","object","function","undefined",
  "null","any","void","never","unknown","type","namespace","declare","global",
  "React","Component","useState","useEffect","useRef","useMemo","useCallback",
  "Document","Window","Element","Event","Array","Promise","Map","Set",
]);

function highlightJS(source: string): string {
  const escaped = escapeHtml(source);
  let out = "";
  let i = 0;
  const n = escaped.length;
  while (i < n) {
    const ch = escaped[i];
    // Line comment
    if (ch === "/" && i + 1 < n && escaped[i + 1] === "/") {
      const end = escaped.indexOf("\n", i);
      const segment = end === -1 ? escaped.slice(i) : escaped.slice(i, end);
      out += span("comment", segment);
      i = end === -1 ? n : end;
      continue;
    }
    // Block comment
    if (ch === "/" && i + 1 < n && escaped[i + 1] === "*") {
      const end = escaped.indexOf("*/", i + 2);
      const segment = end === -1 ? escaped.slice(i) : escaped.slice(i, end + 2);
      out += span("comment", segment);
      i = end === -1 ? n : end + 2;
      continue;
    }
    // Template literal
    if (ch === "`") {
      const end = escaped.indexOf("`", i + 1);
      const segment = end === -1 ? escaped.slice(i) : escaped.slice(i, end + 1);
      out += span("string", segment);
      i = end === -1 ? n : end + 1;
      continue;
    }
    // Single / double quote string
    if (ch === "'" || ch === '"') {
      const end = escaped.indexOf(ch, i + 1);
      const segment = end === -1 ? escaped.slice(i) : escaped.slice(i, end + 1);
      out += span("string", segment);
      i = end === -1 ? n : end + 1;
      continue;
    }
    // Identifier / keyword / type
    if (/[a-zA-Z_$]/.test(ch)) {
      const m = /[a-zA-Z0-9_$]*/.exec(escaped.slice(i));
      const word = m![0];
      if (JS_KEYWORDS.has(word)) {
        out += span("keyword", word);
      } else if (JS_TYPES.has(word)) {
        out += span("type", word);
      } else {
        out += word;
      }
      i += word.length;
      continue;
    }
    // Punctuation / numbers
    if (/[0-9]/.test(ch)) {
      const m = /[0-9.]+/.exec(escaped.slice(i));
      out += span("number", m![0]);
      i += m![0].length;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/* ───────── CSS ───────── */

function highlightCSS(source: string): string {
  const escaped = escapeHtml(source);
  let out = "";
  let i = 0;
  const n = escaped.length;
  while (i < n) {
    const ch = escaped[i];
    if (ch === "/" && i + 1 < n && escaped[i + 1] === "*") {
      const end = escaped.indexOf("*/", i + 2);
      const segment = end === -1 ? escaped.slice(i) : escaped.slice(i, end + 2);
      out += span("comment", segment);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = escaped.indexOf(ch, i + 1);
      const segment = end === -1 ? escaped.slice(i) : escaped.slice(i, end + 1);
      out += span("string", segment);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (ch === "#") {
      const m = /#[a-zA-Z0-9_-]+/.exec(escaped.slice(i));
      out += span("value", m![0]);
      i += m![0].length;
      continue;
    }
    if (/[a-zA-Z_-]/.test(ch)) {
      const m = /[a-zA-Z0-9_-]+/.exec(escaped.slice(i));
      const word = m![0];
      // Heuristic: a property is followed (after optional whitespace) by a colon.
      const rest = escaped.slice(i + word.length);
      const looksLikeProperty = /^\s*:/.test(rest);
      out += looksLikeProperty ? span("property", word) : word;
      i += word.length;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/* ───────── HTML / JSX ───────── */

function highlightMarkup(source: string): string {
  const escaped = escapeHtml(source);
  let out = "";
  let i = 0;
  const n = escaped.length;
  while (i < n) {
    const ch = escaped[i];
    if (ch === "<") {
      const gt = escaped.indexOf(">", i + 1);
      const segment = gt === -1 ? escaped.slice(i) : escaped.slice(i, gt + 1);
      const inner = segment.slice(1, segment.length - 1);
      const closing = inner.startsWith("/");
      const nameMatch = /^[a-zA-Z][a-zA-Z0-9]*/.exec(
        closing ? inner.slice(1) : inner
      );
      const name = nameMatch ? nameMatch[0] : "";
      let highlighted = segment;
      if (name) {
        highlighted =
          `<span class="syntax--tag">&lt;${closing ? "/" : ""}</span>` +
          `<span class="syntax--tag-name">${name}</span>`;
        const afterName = segment.slice(
          1 + (closing ? 1 : 0) + name.length,
          segment.length - 1
        );
        // attributes inside the tag
        const attrParts: string[] = [];
        let rest = afterName;
        while (rest.length > 0) {
          const ws = /^\s+/.exec(rest);
          if (ws) { attrParts.push(ws[0]); rest = rest.slice(ws[0].length); continue; }
          if (rest === "/" || rest.startsWith("/>")) { attrParts.push(rest.slice(0,1)); rest = rest.slice(1); continue; }
          const am = /^[a-zA-Z_$][a-zA-Z0-9_-]*/.exec(rest);
          if (am) {
            attrParts.push(`<span class="syntax--attr">${am[0]}</span>`);
            rest = rest.slice(am[0].length);
            const eq = /^\s*=\s*/.exec(rest);
            if (eq) {
              attrParts.push(eq[0]);
              rest = rest.slice(eq[0].length);
              const q = rest[0];
              if (q === '"' || q === "'") {
                const end = rest.indexOf(q, 1);
                const str = end === -1 ? rest : rest.slice(0, end + 1);
                attrParts.push(span("string", str));
                rest = end === -1 ? "" : rest.slice(end + 1);
              } else {
                const m = /^[^\s>]+/.exec(rest);
                attrParts.push(span("value", m ? m[0] : ""));
                rest = m ? rest.slice(m[0].length) : "";
              }
            }
            continue;
          }
          attrParts.push(rest);
          rest = "";
        }
        highlighted += attrParts.join("");
        highlighted += `</span>`; // close the outer tag span wrapper
        // re-wrap: the tag opener already emitted; rebuild properly below
        highlighted = `<span class="syntax--tag">&lt;${closing ? "/" : ""}</span><span class="syntax--tag-name">${name}</span>${attrParts.join("")}<span class="syntax--tag">&gt;</span>`;
      }
      out += highlighted;
      i += segment.length;
      continue;
    }
    // Text between tags (also catch comments)
    if (ch === "&" && escaped.slice(i, i + 4) === "&lt;") {
      // already escaped; treat following run as text until next tag
      const next = escaped.indexOf("<", i);
      const segment = next === -1 ? escaped.slice(i) : escaped.slice(i, next);
      out += span("text", segment);
      i = next === -1 ? n : next;
      continue;
    }
    const next = escaped.indexOf("<", i);
    const segment = next === -1 ? escaped.slice(i) : escaped.slice(i, next);
    out += span("text", segment);
    i = next === -1 ? n : next;
  }
  return out;
}

/* ───────── JSON ───────── */

const JSON_KEYWORDS = new Set(["true","false","null"]);

function highlightJSON(source: string): string {
  const escaped = escapeHtml(source);
  let out = "";
  let i = 0;
  const n = escaped.length;
  inString: while (i < n) {
    const ch = escaped[i];
    if (ch === '"') {
      let end = i + 1;
      while (end < n) {
        if (escaped[end] === "\\") { end += 2; continue; }
        if (escaped[end] === '"') break;
        end += 1;
      }
      const segment = escaped.slice(i, end + 1);
      // A key is a string followed (after whitespace) by a colon.
      const rest = escaped.slice(end + 1);
      if (/^\s*:/.test(rest)) {
        out += span("key", segment);
      } else {
        out += span("string", segment);
      }
      i = end + 1;
      continue inString;
    }
    if (/[a-zA-Z]/.test(ch)) {
      const m = /[a-zA-Z]+/.exec(escaped.slice(i));
      const word = m![0];
      out += JSON_KEYWORDS.has(word) ? span("keyword", word) : word;
      i += word.length;
      continue inString;
    }
    if (/[0-9\-]/.test(ch)) {
      const m = /-?[0-9.]+/.exec(escaped.slice(i));
      out += span("number", m![0]);
      i += m![0].length;
      continue inString;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function highlight(code: string, language: SyntaxLanguage): string {
  if (!code || code.length === 0) return "";
  switch (language) {
    case "tsx":
    case "jsx":
      return highlightMarkup(highlightJS(code));
    case "ts":
    case "js":
      return highlightJS(code);
    case "css":
      return highlightCSS(code);
    case "html":
      return highlightMarkup(code);
    case "json":
      return highlightJSON(code);
    default:
      return escapeHtml(code);
  }
}
