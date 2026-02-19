import { describe, it, expect } from "vitest";
import { VERSION as coreVersion } from "@agentbouncr/core";
import { VERSION as sqliteVersion } from "@agentbouncr/sqlite";
import { VERSION as cliVersion } from "@agentbouncr/cli";

describe("Monorepo Setup", () => {
  it("should resolve @agentbouncr/core workspace", () => {
    expect(coreVersion).toBe("0.1.0");
  });

  it("should resolve @agentbouncr/sqlite workspace", () => {
    expect(sqliteVersion).toBe("0.1.0");
  });

  it("should resolve @agentbouncr/cli workspace", () => {
    expect(cliVersion).toBe("0.1.0");
  });
});
