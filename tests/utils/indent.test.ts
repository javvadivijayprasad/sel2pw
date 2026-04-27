import { describe, it, expect } from "vitest";
import { dedentAndIndent } from "../../src/utils/indent";

describe("dedentAndIndent", () => {
  it("strips leading and trailing blank lines", () => {
    expect(dedentAndIndent("\n\n  foo\n\n", "")).toBe("foo");
  });

  it("dedents to the minimum common indent then re-indents", () => {
    const body = "        a\n        b\n            c";
    expect(dedentAndIndent(body, "    ")).toBe("    a\n    b\n        c");
  });

  it("preserves nested indentation", () => {
    const body = "    if (x) {\n        foo();\n    }";
    expect(dedentAndIndent(body, "  ")).toBe("  if (x) {\n      foo();\n  }");
  });

  it("returns empty for an all-blank body", () => {
    expect(dedentAndIndent("\n   \n   \n", "    ")).toBe("");
  });

  it("handles mixed tabs and spaces gracefully", () => {
    const body = "\tfoo\n\tbar";
    expect(dedentAndIndent(body, "  ")).toBe("  foo\n  bar");
  });
});
