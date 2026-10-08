import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnimatedLineBackground, generateAnimatedLinePaths, normalizeAnimatedLineConfig } from "./animated-line-background";

describe("AnimatedLineBackground", () => {
  it("keeps geometry deterministic for identical props and changes it for a different seed", () => {
    const first = generateAnimatedLinePaths({ lineCount: 7, density: 1.1, seed: "accounts" });
    const repeat = generateAnimatedLinePaths({ lineCount: 7, density: 1.1, seed: "accounts" });
    const different = generateAnimatedLinePaths({ lineCount: 7, density: 1.1, seed: "cash-flow" });

    expect(first).toEqual(repeat);
    expect(first).not.toEqual(different);
    expect(first.every((path) => path.d.startsWith("M "))).toBe(true);
    expect(first.every((path) => path.morphValues.split(";").length === 4)).toBe(true);
    expect(first.some((path) => path.morphValues !== `${path.d};${path.d};${path.d};${path.d}`)).toBe(true);
    expect(first.some((path) => path.hasAccent)).toBe(true);
  });

  it("clamps excessive configuration values to safe rendering limits", () => {
    const normalized = normalizeAnimatedLineConfig({
      lineCount: 1000,
      opacity: 10,
      speed: -20,
      scale: 10,
      strokeWidth: 10,
      density: -4,
      drift: 4,
      waveAmplitude: 400,
      pulseStrength: 4,
    });

    expect(normalized.lineCount).toBe(24);
    expect(normalized.opacity).toBe(0.9);
    expect(normalized.speed).toBe(6);
    expect(normalized.scale).toBe(1.8);
    expect(normalized.strokeWidth).toBe(4);
    expect(normalized.density).toBe(0.55);
    expect(normalized.drift).toBe(1);
    expect(normalized.waveAmplitude).toBe(90);
    expect(normalized.pulseStrength).toBe(1);
    expect(generateAnimatedLinePaths({ lineCount: 1000 })).toHaveLength(24);
  });

  it("mixes fine supporting strokes with three heavier feature lines on large fields", () => {
    const strokeWidth = 1.65;
    const paths = generateAnimatedLinePaths({ lineCount: 15, strokeWidth, seed: "overview-net-worth" });
    const featureLines = paths.filter((path) => path.strokeWidth >= strokeWidth * 2);

    expect(featureLines).toHaveLength(3);
    expect(Math.min(...paths.map((path) => path.strokeWidth))).toBeLessThan(strokeWidth);
    expect(Math.max(...paths.map((path) => path.strokeWidth))).toBeGreaterThan(strokeWidth * 2);
  });

  it("emits stable public metadata and decorative SVG attributes", () => {
    const markup = renderToStaticMarkup(<AnimatedLineBackground
      lineCount={5}
      opacity={0.17}
      speed={48}
      scale={1.1}
      strokeWidth={0.8}
      density={1.2}
      drift={0.3}
      waveAmplitude={44}
      pulseStrength={0.88}
      color="#AA9977"
      accentColor="#D7B76A"
      direction="right-to-left"
      seed="security"
      className="animated-line-background--public-security"
    />);

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).toContain('pointer-events="none"');
    expect(markup).toContain('data-line-count="5"');
    expect(markup).toContain('data-direction="right-to-left"');
    expect(markup).toContain('data-seed="security"');
    expect(markup).toContain("animated-line-background__accent");
    expect(markup).toContain("animated-line-background__morph");
    expect(markup).toContain('class="animated-line-background__mobile-art"');
    expect(markup).toContain('href="/brand/back-lines.svg"');
    expect(markup).toContain('preserveAspectRatio="xMaxYMax slice"');
    expect(markup).toContain('attributeName="d"');
  });

  it("keeps the primitive server-renderable with its decorative mobile artwork", () => {
    const markup = renderToStaticMarkup(<AnimatedLineBackground className="server-rendered-lines" seed="server-rendered" />);

    expect(markup).toContain("<svg");
    expect(markup).toContain('class="animated-line-background server-rendered-lines"');
    expect(markup).toContain('class="animated-line-background__mobile-art"');
    expect(markup).toContain('href="/brand/back-lines.svg"');
  });
});
