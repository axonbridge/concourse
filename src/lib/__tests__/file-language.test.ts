import { describe, expect, it } from "vitest";
import { languageForFilename } from "../file-language";

describe("languageForFilename", () => {
  it("returns a language for .ts", () => {
    expect(languageForFilename("foo.ts").length).toBeGreaterThan(0);
  });
  it("returns a language for .tsx", () => {
    expect(languageForFilename("Foo.tsx").length).toBeGreaterThan(0);
  });
  it("returns a language for .js / .jsx / .mjs / .cjs", () => {
    expect(languageForFilename("a.js").length).toBeGreaterThan(0);
    expect(languageForFilename("a.jsx").length).toBeGreaterThan(0);
    expect(languageForFilename("a.mjs").length).toBeGreaterThan(0);
    expect(languageForFilename("a.cjs").length).toBeGreaterThan(0);
  });
  it("returns a language for package.json / .json", () => {
    expect(languageForFilename("package.json").length).toBeGreaterThan(0);
    expect(languageForFilename("tsconfig.json").length).toBeGreaterThan(0);
  });
  it("returns a language for .env / .env.local", () => {
    expect(languageForFilename(".env").length).toBeGreaterThan(0);
    expect(languageForFilename(".env.local").length).toBeGreaterThan(0);
  });
  it("returns a language for common non-JS files", () => {
    expect(languageForFilename("README.md").length).toBeGreaterThan(0);
    expect(languageForFilename("styles.css").length).toBeGreaterThan(0);
    expect(languageForFilename("main.py").length).toBeGreaterThan(0);
    expect(languageForFilename("config.yaml").length).toBeGreaterThan(0);
    expect(languageForFilename("setup.sh").length).toBeGreaterThan(0);
    expect(languageForFilename("Cargo.toml").length).toBeGreaterThan(0);
  });
  it("returns empty for unknown extensions", () => {
    expect(languageForFilename("data.csv")).toEqual([]);
    expect(languageForFilename("archive.tar")).toEqual([]);
  });
  it("works with full paths", () => {
    expect(languageForFilename("src/foo/bar.ts").length).toBeGreaterThan(0);
    expect(languageForFilename("apps/api/.env").length).toBeGreaterThan(0);
  });
});
