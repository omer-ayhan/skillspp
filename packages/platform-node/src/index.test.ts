import { describe, expect, it } from "vitest";
import { createNodeCoreCommandPort, createNodeCoreServices, runBackgroundTask } from "./index";

describe("platform-node root exports @unit", () => {
  it("exposes transport/runtime entrypoints @unit", () => {
    expect(typeof createNodeCoreCommandPort).toBe("function");
    expect(typeof createNodeCoreServices).toBe("function");
    expect(typeof runBackgroundTask).toBe("function");

    const services = createNodeCoreServices();
    expect(typeof services.addSkill.execute).toBe("function");
    expect(typeof services.updateSkill.execute).toBe("function");
    expect(typeof services.checkSkill.execute).toBe("function");
    expect(typeof services.validateSkill.execute).toBe("function");
    expect(typeof services.listSkill.execute).toBe("function");
    expect(typeof services.removeSkill.execute).toBe("function");
    expect(typeof services.findSkill.execute).toBe("function");
    expect(typeof services.initSkill.execute).toBe("function");
  });
});
