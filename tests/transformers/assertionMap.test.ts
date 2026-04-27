import { describe, it, expect } from "vitest";
import { applyAssertionRewrites } from "../../src/transformers/assertionMap";

describe("applyAssertionRewrites", () => {
  it("assertEquals(a, b) -> expect(a).toBe(b)", () => {
    expect(applyAssertionRewrites("Assert.assertEquals(welcome, expected);")).toBe(
      "expect(welcome).toBe(expected);",
    );
  });

  it("handles commas inside string literals", () => {
    // Regression for the original regex-based bug.
    expect(
      applyAssertionRewrites('Assert.assertEquals(welcome, "Welcome, alice!");'),
    ).toBe('expect(welcome).toBe("Welcome, alice!");');
  });

  it("3-arg assertEquals with message attaches it to expect", () => {
    expect(
      applyAssertionRewrites(
        'Assert.assertEquals(actual, expected, "should match");',
      ),
    ).toBe('expect(actual, "should match").toBe(expected);');
  });

  it("assertNotEquals -> expect().not.toBe", () => {
    expect(applyAssertionRewrites("Assert.assertNotEquals(a, b);")).toBe(
      "expect(a).not.toBe(b);",
    );
  });

  it("assertTrue with parens-in-arg (function call)", () => {
    expect(
      applyAssertionRewrites("Assert.assertTrue(homePage.isLogoutVisible());"),
    ).toBe("expect(homePage.isLogoutVisible()).toBe(true);");
  });

  it("assertTrue with message", () => {
    expect(
      applyAssertionRewrites('Assert.assertTrue(ok, "should be ok");'),
    ).toBe('expect(ok, "should be ok").toBe(true);');
  });

  it("assertFalse / assertNull / assertNotNull", () => {
    expect(applyAssertionRewrites("Assert.assertFalse(broken);")).toBe(
      "expect(broken).toBe(false);",
    );
    expect(applyAssertionRewrites("Assert.assertNull(x);")).toBe(
      "expect(x).toBeNull();",
    );
    expect(applyAssertionRewrites("Assert.assertNotNull(y);")).toBe(
      "expect(y).not.toBeNull();",
    );
  });

  it("Assert.fail with message -> throw new Error", () => {
    expect(applyAssertionRewrites('Assert.fail("nope");')).toBe(
      'throw new Error("nope");',
    );
  });

  it("Assert.fail without message -> throw new Error('Test failed')", () => {
    expect(applyAssertionRewrites("Assert.fail();")).toBe(
      "throw new Error('Test failed');",
    );
  });

  it("multiple assertions in one block", () => {
    const input = [
      "Assert.assertEquals(a, 1);",
      "Assert.assertTrue(b);",
      'Assert.assertEquals(c, "x, y");',
    ].join("\n");
    const out = applyAssertionRewrites(input);
    expect(out).toContain("expect(a).toBe(1);");
    expect(out).toContain("expect(b).toBe(true);");
    expect(out).toContain('expect(c).toBe("x, y");');
  });

  it("does not touch non-Assert calls that look similar", () => {
    expect(applyAssertionRewrites("Other.assertEquals(a, b);")).toBe(
      "Other.assertEquals(a, b);",
    );
  });

  it("leaves an assert without trailing ; alone (defensive)", () => {
    expect(
      applyAssertionRewrites("Assert.assertEquals(a, b)\nsomethingElse"),
    ).toContain("Assert.assertEquals");
  });
});
