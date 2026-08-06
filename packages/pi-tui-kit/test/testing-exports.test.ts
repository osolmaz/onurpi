import assert from "node:assert/strict";
import { test } from "vitest";

test("package roots resolve separate production and testing exports", async () => {
  const production = await import("../src/index.js");
  const testing = await import("../src/testing/index.js");
  assert.equal(production.PI_EXTENSION_MENU_API_VERSION, 6);
  assert.equal(typeof production.runCustomInteraction, "function");
  assert.equal("createTuiHarness" in production, false);
  assert.equal("createRpcHarness" in production, false);
  assert.deepEqual(Object.keys(testing).sort(), ["createRpcHarness", "createTuiHarness"]);
});
