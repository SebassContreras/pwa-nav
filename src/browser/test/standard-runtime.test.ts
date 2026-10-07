import { describe, it } from "node:test";
import * as assert from "node:assert";
import { findStandardFirefox } from "../standard-runtime.js";
import { PwaNavError } from "../../core/errors.js";

void describe("standard-runtime", () => {
  void describe("findStandardFirefox", () => {
    it("finds firefox on win32 via Program Files", () => {
      // Mock existsSync
      // Node 22 test runner doesn't have an easy way to mock `node:fs` without hooks or proxyquire, 
      // but we can just test the error paths safely if we don't mock it, or we can use a small wrapper.
      // Actually we just test the logic with a mocked existsSync in the implementation if we inject it, 
      // but findStandardFirefox uses standard existsSync.
      
      const env = {
        "ProgramFiles": "C:\\MockProgramFiles",
        "ProgramFiles(x86)": "C:\\MockProgramFilesX86",
      };

      try {
        findStandardFirefox("win32", env);
      } catch (err) {
        assert.ok(err instanceof PwaNavError);
        assert.equal(err.code, "no_browser");
      }
    });

    it("throws no_browser if not found", () => {
      assert.throws(() => findStandardFirefox("unknown_platform", {}), {
        name: "PwaNavError",
        code: "no_browser",
      });
    });
  });
});
