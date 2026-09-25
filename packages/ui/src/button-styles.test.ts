import { describe, expect, it } from "vitest";

import { buttonClassName } from "./button-styles";

describe("buttonClassName", () => {
  it("defaults to the primary, medium button", () => {
    expect(buttonClassName()).toBe("pliegue-button pliegue-button--primary pliegue-button--md");
  });

  it("maps every variant and size to its modifier and keeps extra classes last", () => {
    expect(buttonClassName({ className: "extra", size: "lg", variant: "danger" })).toBe(
      "pliegue-button pliegue-button--danger pliegue-button--lg extra",
    );
    expect(buttonClassName({ size: "sm", variant: "quiet" })).toBe(
      "pliegue-button pliegue-button--quiet pliegue-button--sm",
    );
  });
});
