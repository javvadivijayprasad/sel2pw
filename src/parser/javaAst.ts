import {
  JavaFile,
  PageObjectIR,
  TestClassIR,
  LocatorField,
  ByStrategy,
  PageMethodIR,
  ParamIR,
  TestMethodIR,
  LifecycleMethodIR,
  TestNgLifecycle,
} from "../types";
import { logger } from "../utils/logger";
import {
  extractPageObject as extractPageObjectLegacy,
  extractTestClass as extractTestClassLegacy,
} from "./javaExtractor";

/**
 * AST-based Java extractor using `java-parser` (Chevrotain CST).
 *
 * Why a new module: the regex extractor in `javaExtractor.ts` is robust
 * for conventional shapes but brittle on nested classes, lambdas, multi-line
 * generics, and method signatures that span multiple lines. The AST walker
 * here is the canonical implementation. It produces the EXACT same IR
 * shape so emitters/transformers don't change.
 *
 * Fallback: if the optional `java-parser` dependency isn't installed, OR
 * the parse throws on a particular file, we log a warning and return the
 * regex-extractor's result so the conversion still completes. This keeps
 * the tool resilient against upstream parser bugs and gradual rollout.
 */

type JavaParserModule = {
  parse: (src: string) => unknown;
};

let cachedParser: JavaParserModule | null = null;
let parserMissing = false;
function loadParser(): JavaParserModule | null {
  if (parserMissing) return null;
  if (cachedParser !== null) return cachedParser;
  try {
    // Optional dependency — degrade gracefully if not installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedParser = require("java-parser") as JavaParserModule;
    return cachedParser;
  } catch {
    parserMissing = true;
    logger.warn(
      "java-parser not installed; falling back to regex extractor. Run `npm install java-parser` for AST-grade parsing.",
    );
    return null;
  }
}

export function extractPageObject(file: JavaFile): PageObjectIR {
  const parser = loadParser();
  if (!parser) return extractPageObjectLegacy(file);
  try {
    const cst = parser.parse(file.source);
    return extractPageObjectFromCst(file, cst);
  } catch (err: any) {
    logger.warn(
      { file: file.path, err: err.message },
      "AST parse failed; using regex extractor for this file",
    );
    return extractPageObjectLegacy(file);
  }
}

export function extractTestClass(file: JavaFile): TestClassIR {
  const parser = loadParser();
  if (!parser) return extractTestClassLegacy(file);
  try {
    const cst = parser.parse(file.source);
    return extractTestClassFromCst(file, cst);
  } catch (err: any) {
    logger.warn(
      { file: file.path, err: err.message },
      "AST parse failed; using regex extractor for this file",
    );
    return extractTestClassLegacy(file);
  }
}

// ---------- CST walker helpers ----------

interface CstNode {
  name?: string;
  children?: Record<string, (CstNode | { image?: string })[]>;
  image?: string;
}

/** Recursively find all nodes with the given name. Depth-first. */
function findAll(node: CstNode | undefined, name: string): CstNode[] {
  if (!node) return [];
  const out: CstNode[] = [];
  const stack: CstNode[] = [node];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.name === name) out.push(cur);
    if (cur.children) {
      for (const arr of Object.values(cur.children)) {
        for (const child of arr) {
          if ((child as CstNode).children !== undefined || (child as CstNode).name) {
            stack.push(child as CstNode);
          }
        }
      }
    }
  }
  return out;
}

/** Concatenate all token images under a node — yields the original source text. */
function nodeText(node: CstNode | undefined): string {
  if (!node) return "";
  let out = "";
  const stack: CstNode[] = [node];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.image !== undefined) {
      out = cur.image + " " + out;
      continue;
    }
    if (cur.children) {
      // Reverse so left-to-right traversal results in correct order with stack
      const all = Object.values(cur.children).flat();
      for (let i = all.length - 1; i >= 0; i--) {
        stack.push(all[i] as CstNode);
      }
    }
  }
  return out.trim();
}

// ---------- IR extraction from CST ----------

function extractPageObjectFromCst(file: JavaFile, cst: unknown): PageObjectIR {
  const root = cst as CstNode;
  const fields = extractLocatorFieldsFromCst(root, file.source);
  const methods = extractPageMethodsFromCst(root, file.source, file.className);
  const unknownFields = extractUnknownFieldsFromCst(root, fields);

  return {
    className: file.className,
    packageName: file.packageName,
    fields,
    methods,
    unknownFields,
  };
}

function extractTestClassFromCst(file: JavaFile, cst: unknown): TestClassIR {
  const root = cst as CstNode;
  const all = extractAnnotatedMethodsFromCst(root, file.source);

  // The CST walker yielded no annotated methods. If the source clearly has
  // some, the AST node names didn't match what we expect (java-parser version
  // drift, exotic shape, etc.). Defer to the regex extractor, which is known
  // to work for typical TestNG / JUnit class shapes.
  if (
    all.length === 0 &&
    /@(Test|Before|After)(Suite|Class|Method|Test|Each|All)?\b/.test(file.source)
  ) {
    return extractTestClassLegacy(file);
  }

  const lifecycle: LifecycleMethodIR[] = [];
  const testMethods: TestMethodIR[] = [];

  for (const m of all) {
    const lifecycleAnno = m.annotations.find((a) =>
      /^(Before|After)(Suite|Class|Method|Test)\b/.test(a),
    );
    if (lifecycleAnno) {
      const kind = lifecycleAnno.replace(/\(.*$/, "") as TestNgLifecycle;
      lifecycle.push({ kind, name: m.name, rawBody: m.rawBody });
      continue;
    }
    const testAnno = m.annotations.find((a) => /^Test\b/.test(a));
    if (testAnno) {
      testMethods.push({
        name: m.name,
        params: m.params,
        annotations: m.annotations,
        description: parseAnnoArg(testAnno, "description"),
        dataProvider: parseAnnoArg(testAnno, "dataProvider"),
        groups: (parseAnnoArg(testAnno, "groups") || "")
          .replace(/^\{|\}$/g, "")
          .split(",")
          .map((s) => s.trim().replace(/^"|"$/g, ""))
          .filter(Boolean),
        rawBody: m.rawBody,
      });
    }
  }

  // Field-driven Page Object discovery — same heuristic as the legacy extractor.
  const pageObjectTypes = Array.from(
    new Set(
      Array.from(
        file.source.matchAll(
          /(?:private|protected|public)\s+(?:final\s+)?(\w+Page)\s+\w+\s*(?:=|;)/g,
        ),
      ).map((mm) => mm[1]),
    ),
  );

  const baseMatch = file.source.match(/class\s+\w+\s+extends\s+(\w+)/);

  return {
    className: file.className,
    packageName: file.packageName,
    pageObjectTypes,
    lifecycle,
    testMethods,
    extendsBase: !!baseMatch,
    baseClassName: baseMatch ? baseMatch[1] : undefined,
  };
}

// ---------- field/method extraction (CST-aware where possible) ----------

function extractLocatorFieldsFromCst(root: CstNode, source: string): LocatorField[] {
  // Walk all fieldDeclaration nodes; for each, slice the source range and
  // delegate to the same regex used by the legacy extractor — this gives us
  // structural confidence (we know it's a field) plus the proven mapping.
  const fields: LocatorField[] = [];

  for (const fd of findAll(root, "fieldDeclaration")) {
    const text = nodeText(fd);
    const byMatch =
      /By\s+(\w+)\s*=\s*By\.(id|cssSelector|xpath|name|linkText|partialLinkText|tagName|className)\s*\(\s*"([^"]*)"\s*\)/.exec(
        text,
      );
    if (byMatch) {
      fields.push({
        name: byMatch[1],
        by: normalizeBy(byMatch[2]),
        value: byMatch[3],
        rawLine: text,
      });
      continue;
    }
    const findByMatch =
      /@FindBy\s*\(\s*(id|css|xpath|name|linkText|partialLinkText|tagName|className)\s*=\s*"([^"]*)"\s*\)\s*(?:private|protected|public)?\s*(?:static\s+)?(?:final\s+)?WebElement\s+(\w+)/.exec(
        text,
      );
    if (findByMatch) {
      fields.push({
        name: findByMatch[3],
        by: normalizeBy(findByMatch[1]),
        value: findByMatch[2],
        rawLine: text,
      });
    }
  }
  // If the CST gave us nothing (weird Java), fall back to source-level regex.
  if (fields.length === 0) {
    return extractPageObjectLegacy({ source } as JavaFile).fields;
  }
  return fields;
}

function extractUnknownFieldsFromCst(root: CstNode, known: LocatorField[]): string[] {
  const knownNames = new Set(known.map((f) => f.name));
  const out: string[] = [];
  for (const fd of findAll(root, "fieldDeclaration")) {
    const text = nodeText(fd);
    const m = /^\s*(?:private|protected|public)\s+(?:static\s+)?(?:final\s+)?(\w[\w<>,\s]*?)\s+(\w+)/.exec(
      text,
    );
    if (!m) continue;
    const type = m[1].trim();
    const name = m[2];
    if (knownNames.has(name)) continue;
    if (type === "WebDriver" || type === "By" || type === "WebElement") continue;
    out.push(`${type} ${name}`);
  }
  return out;
}

function extractPageMethodsFromCst(
  root: CstNode,
  source: string,
  className: string,
): PageMethodIR[] {
  const methods: PageMethodIR[] = [];
  for (const md of findAll(root, "methodDeclaration")) {
    const sig = parseSignatureFromNode(md);
    if (!sig) continue;
    if (sig.name === className) continue; // skip ctor
    if (!sig.isPublic) continue; // Page Object methods are public
    if (sig.annotations.length > 0) continue; // annotated methods belong to test classes
    methods.push({
      name: sig.name,
      params: sig.params,
      returnType: sig.returnType,
      rawBody: sig.rawBody,
    });
  }
  if (methods.length === 0) {
    return extractPageObjectLegacy({ source } as JavaFile).methods;
  }
  return methods;
}

interface AnnotatedMethod {
  annotations: string[];
  name: string;
  params: ParamIR[];
  returnType: string;
  rawBody: string;
}

function extractAnnotatedMethodsFromCst(
  root: CstNode,
  _source: string,
): AnnotatedMethod[] {
  const out: AnnotatedMethod[] = [];
  for (const md of findAll(root, "methodDeclaration")) {
    const sig = parseSignatureFromNode(md);
    if (!sig) continue;
    if (sig.annotations.length === 0) continue;
    out.push({
      annotations: sig.annotations,
      name: sig.name,
      params: sig.params,
      returnType: sig.returnType,
      rawBody: sig.rawBody,
    });
  }
  if (out.length === 0) {
    // Fall back to the regex method walker
    return [];
  }
  return out;
}

interface ParsedSignature {
  isPublic: boolean;
  annotations: string[];
  name: string;
  returnType: string;
  params: ParamIR[];
  rawBody: string;
}

function parseSignatureFromNode(md: CstNode): ParsedSignature | null {
  // Slice the original text the CST node covers, then reuse a small regex to
  // pluck name/params/body. java-parser's CST is intentionally raw; rebuilding
  // the signature from individual tokens is more brittle than this hybrid.
  const text = nodeText(md);
  const annotations: string[] = [];
  const annoRe = /@([A-Z]\w*)(\s*\(([^)]*)\))?/g;
  let am: RegExpExecArray | null;
  while ((am = annoRe.exec(text)) !== null) {
    annotations.push(am[1] + (am[2] ?? ""));
  }
  const sigRe =
    /(?:@\w+(?:\s*\([^)]*\))?\s*)*(public|protected|private)?\s*(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?([\w<>[\],\s?]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/.exec(
      text,
    );
  if (!sigRe) return null;
  const isPublic = (sigRe[1] ?? "") === "public";
  const returnType = sigRe[2].trim();
  const name = sigRe[3];
  const paramsRaw = sigRe[4].trim();
  const params: ParamIR[] = paramsRaw
    ? paramsRaw.split(",").map((p) => {
        const parts = p.trim().split(/\s+/);
        return {
          name: parts[parts.length - 1],
          javaType: parts.slice(0, -1).join(" ").replace(/^final\s+/, "") || "Object",
        };
      })
    : [];
  const bodyStart = text.indexOf("{", sigRe.index + sigRe[0].length - 1);
  const rawBody = readBracedBody(text, bodyStart) ?? "";
  return { isPublic, annotations, name, returnType, params, rawBody };
}

function readBracedBody(text: string, start: number): string | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  for (let p = start; p < text.length; p++) {
    const c = text[p];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start + 1, p);
    }
  }
  return null;
}

function normalizeBy(raw: string): ByStrategy {
  if (raw === "cssSelector" || raw === "css") return "css";
  return raw as ByStrategy;
}

function parseAnnoArg(annotation: string, key: string): string | undefined {
  const re = new RegExp(`${key}\\s*=\\s*("([^"]*)"|\\{[^}]*\\})`);
  const m = annotation.match(re);
  if (!m) return undefined;
  return m[2] !== undefined ? m[2] : m[1];
}
