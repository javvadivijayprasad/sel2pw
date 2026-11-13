import { describe, expect, it } from "vitest";
import { applyLambdaRewrites, maskNonCode } from "../../src/transformers/lambdaMap";
import { transformMethodBody } from "../../src/transformers/bodyTransformer";

const rw = (src: string) => applyLambdaRewrites(src, "Test.java");

describe("Java lambdas -> TypeScript arrow functions (#20)", () => {
  it("rewrites a single untyped parameter", () => {
    expect(rw("items.forEach(e -> e.click());").body).toBe(
      "items.forEach((e) => e.click());",
    );
  });

  it("rewrites several parameters", () => {
    expect(rw("list.sort((a, b) -> a.compareTo(b));").body).toBe(
      "list.sort((a, b) => a.compareTo(b));",
    );
  });

  it("drops Java parameter types, including generics and final", () => {
    expect(rw("m.forEach((String k, Integer v) -> log(k, v));").body).toBe(
      "m.forEach((k, v) => log(k, v));",
    );
    expect(rw("x.apply((final Map<String, List<Integer>> m) -> m.size());").body).toBe(
      "x.apply((m) => m.size());",
    );
  });

  it("rewrites a no-argument lambda and a block body", () => {
    expect(rw("new Thread(() -> {\n  run();\n});").body).toBe(
      "new Thread(() => {\n  run();\n});",
    );
    expect(rw("return driver -> {\n  return true;\n};").body).toBe(
      "return (driver) => {\n  return true;\n};",
    );
  });

  it("rewrites nested and adjacent lambdas, including the _ parameter", () => {
    expect(rw("toMap(i -> i.value, i -> i, (_, b) -> b)").body).toBe(
      "toMap((i) => i.value, (i) => i, (_, b) => b)",
    );
    const out = rw(
      "a.stream().sorted((x, y) -> y.length() - x.length()).filter(s -> s.isEmpty())",
    );
    expect(out.converted).toBe(2);
    expect(out.body).not.toContain("->");
  });

  it("leaves strings, character literals and comments alone", () => {
    const src = [
      'String p = "(?<=\\\\-> ).*";',
      "// step 1 --> step 2",
      "/* a -> b */",
      'log("Report--->dir");',
      "char c = '>';",
      "items.forEach(e -> e.click());",
    ].join("\n");
    const out = rw(src);
    expect(out.converted).toBe(1);
    expect(out.body).toContain('String p = "(?<=\\\\-> ).*";');
    expect(out.body).toContain("// step 1 --> step 2");
    expect(out.body).toContain("/* a -> b */");
    expect(out.body).toContain('log("Report--->dir");');
    expect(out.body).toContain("items.forEach((e) => e.click());");
  });

  it("does not touch XPath axes inside strings", () => {
    const src = 'By.xpath("//li/parent::ul/following-sibling::div")';
    expect(rw(src).body).toBe(src);
  });

  it("does not treat x-->0 as a lambda", () => {
    expect(rw("while (x-->0) step();").body).toBe("while (x-->0) step();");
  });

  it("leaves Java switch arrows unconverted and warns once", () => {
    const src =
      "switch (t) {\n  case LOCAL -> a();\n  case GRID, REMOTE -> b();\n  default -> c();\n}";
    const out = rw(src);
    expect(out.body).toBe(src);
    expect(out.converted).toBe(0);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].severity).toBe("warning");
    expect(out.warnings[0].message).toContain("3 cases");
  });

  it("returns the input unchanged when there is no arrow", () => {
    const src = "driver.get(url);";
    const out = rw(src);
    expect(out.body).toBe(src);
    expect(out.warnings).toHaveLength(0);
  });
});

describe("maskNonCode", () => {
  it("keeps positions and blanks only non-code characters", () => {
    const src = 'a("x->y") // c\nb';
    const mask = maskNonCode(src);
    expect(mask).toHaveLength(src.length);
    expect(mask.startsWith("a(")).toBe(true);
    expect(mask).not.toContain("->");
    expect(mask.endsWith("\nb")).toBe(true);
  });
});

describe("bodyTransformer integration", () => {
  it("emits arrow functions in a converted method body", () => {
    const { body } = transformMethodBody(
      'listOfValues.stream().forEach(e -> LOG.info("Unsorted " + e));',
      "Test.java",
    );
    expect(body).toContain("(e) =>");
    expect(body).not.toContain("->");
  });
});
