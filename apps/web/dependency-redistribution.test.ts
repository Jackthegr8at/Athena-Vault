import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(new URL("../../pnpm-workspace.yaml", import.meta.url), "utf8");
const lock = readFileSync(new URL("../../pnpm-lock.yaml", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const docker = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8").replaceAll("\r\n", "\n");

describe("workbook dependency redistribution boundary", () => {
  it("keeps the tested factory and sheets-core versions pinned", () => {
    expect(manifest.dependencies["@univerjs/presets"]).toBe("0.25.1");
    expect(manifest.dependencies["@univerjs/preset-sheets-core"]).toBe("0.25.1");
    expect(lock).toContain("'@univerjs/presets@0.25.1':");
    expect(lock).toContain("'@univerjs/preset-sheets-core@0.25.1':");
  });

  it("removes only unused, version-scoped preset edges", () => {
    const removed = [...workspace.matchAll(/"@univerjs\/presets@0\.25\.1>@univerjs\/preset-([^"]+)": "-"/g)]
      .map((match) => match[1]);
    expect(removed).toHaveLength(20);
    expect(new Set(removed).size).toBe(20);
    expect(removed).not.toContain("sheets-core");
    expect(workspace).not.toMatch(/"@univerjs\/presets(?:@[^">]+)?>@univerjs\/(?:core|themes|preset-sheets-core)": "-"/);
    for (const preset of removed) {
      expect(lock).not.toContain(`'@univerjs/preset-${preset}@0.25.1':`);
    }
  });

  it("has no Univer Pro package in the locked install graph", () => {
    expect(lock).not.toContain("@univerjs-pro/");
  });

  it("regenerates target-platform notices in every dependency-bearing image", () => {
    for (const stage of ["development", "build", "migration"]) {
      const content = docker.split(`FROM base AS ${stage}\n`)[1]?.split("\nFROM ")[0];
      expect(content).toContain("RUN node scripts/generate-third-party-notices.mjs --root /workspace");
    }
    expect(docker).toContain("/workspace/third-party ./third-party");
  });
});
