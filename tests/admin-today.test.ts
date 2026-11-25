import assert from "node:assert/strict";
import test from "node:test";
import { adminQueues } from "../src/lib/admin-today";

test("admin queue titles keep their Bosnian letters", () => {
  for (const { title } of adminQueues) assert.doesNotMatch(title, /[?�]/);
});
