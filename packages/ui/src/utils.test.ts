import { describe, expect, it } from "vitest";

import { cx } from "./utils";

describe("cx", () => {
  it("joins only truthy class names", () => {
    expect(cx("button", false, undefined, "button--primary")).toBe(
      "button button--primary",
    );
  });
});
