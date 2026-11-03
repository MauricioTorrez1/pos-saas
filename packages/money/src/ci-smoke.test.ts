import { expect, test } from "vitest";

import { packageName } from "./ci-smoke.js";

test("returns the package name", () => {
  expect(packageName()).toBe("money");
});
