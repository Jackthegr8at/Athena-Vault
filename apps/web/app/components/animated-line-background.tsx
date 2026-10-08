import React, { type CSSProperties } from "react";

const VIEWBOX_WIDTH = 1200;
const VIEWBOX_HEIGHT = 640;
const DEFAULT_SEED = 17;

export type AnimatedLineDirection = "left-to-right" | "right-to-left" | "upward" | "downward";

export interface AnimatedLineBackgroundProps {
  readonly lineCount?: number;
  readonly opacity?: number;
  readonly speed?: number;
  readonly scale?: number;
  readonly strokeWidth?: number;
  readonly density?: number;
  readonly drift?: number;
  readonly waveAmplitude?: number;
  readonly pulseStrength?: number;
  readonly color?: string;
  readonly accentColor?: string;
  readonly direction?: AnimatedLineDirection;
  readonly seed?: number | string;
  readonly className?: string;
}

export interface NormalizedAnimatedLineConfig {
  readonly lineCount: number;
  readonly opacity: number;
  readonly speed: number;
  readonly scale: number;
  readonly strokeWidth: number;
  readonly density: number;
  readonly drift: number;
  readonly waveAmplitude: number;
  readonly pulseStrength: number;
  readonly color: string;
  readonly accentColor: string;
  readonly direction: AnimatedLineDirection;
  readonly seed: number | string;
}

export interface AnimatedLinePathDefinition {
  readonly d: string;
  readonly morphValues: string;
  readonly strokeWidth: number;
  readonly opacity: number;
  readonly phaseDelaySeconds: number;
  readonly durationSeconds: number;
  readonly driftX: number;
  readonly driftY: number;
  readonly accentDash: string;
  readonly accentOffset: string;
  readonly hasAccent: boolean;
  readonly useAccentTone: boolean;
}

type AnimatedLineStyle = CSSProperties & { readonly [key: `--${string}`]: string | number };

const DEFAULTS = {
  lineCount: 11,
  opacity: 0.3,
  speed: 16,
  scale: 1,
  strokeWidth: 1.35,
  density: 1,
  drift: 0.24,
  waveAmplitude: 34,
  pulseStrength: 0.82,
  color: "#9F9270",
  accentColor: "#E0C681",
  direction: "left-to-right" as const,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeColor(value: string | undefined, fallback: string): string {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 64) return fallback;
  if (/^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([^)]*\)|var\(--[a-z0-9-]+\))$/i.test(candidate)) return candidate;
  return fallback;
}

function normalizeDirection(value: AnimatedLineDirection | undefined): AnimatedLineDirection {
  return value === "left-to-right" || value === "right-to-left" || value === "upward" || value === "downward"
    ? value
    : DEFAULTS.direction;
}

export function normalizeAnimatedLineConfig(props: AnimatedLineBackgroundProps = {}): NormalizedAnimatedLineConfig {
  return {
    lineCount: Math.round(clamp(finiteOr(props.lineCount, DEFAULTS.lineCount), 3, 24)),
    opacity: clamp(finiteOr(props.opacity, DEFAULTS.opacity), 0, 0.9),
    speed: clamp(finiteOr(props.speed, DEFAULTS.speed), 6, 90),
    scale: clamp(finiteOr(props.scale, DEFAULTS.scale), 0.7, 1.8),
    strokeWidth: clamp(finiteOr(props.strokeWidth, DEFAULTS.strokeWidth), 0.45, 4),
    density: clamp(finiteOr(props.density, DEFAULTS.density), 0.55, 1.8),
    drift: clamp(finiteOr(props.drift, DEFAULTS.drift), 0, 1),
    waveAmplitude: clamp(finiteOr(props.waveAmplitude, DEFAULTS.waveAmplitude), 0, 90),
    pulseStrength: clamp(finiteOr(props.pulseStrength, DEFAULTS.pulseStrength), 0, 1),
    color: normalizeColor(props.color, DEFAULTS.color),
    accentColor: normalizeColor(props.accentColor, DEFAULTS.accentColor),
    direction: normalizeDirection(props.direction),
    seed: props.seed ?? DEFAULT_SEED,
  };
}

function seedHash(seed: number | string): number {
  const text = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value: number): string {
  return value.toFixed(2).replace(/\.00$/, "");
}

interface FanCurve {
  readonly startX: number;
  readonly startY: number;
  readonly controlOneX: number;
  readonly controlOneY: number;
  readonly controlTwoX: number;
  readonly controlTwoY: number;
  readonly middleX: number;
  readonly middleY: number;
  readonly controlThreeX: number;
  readonly controlThreeY: number;
  readonly controlFourX: number;
  readonly controlFourY: number;
  readonly endX: number;
  readonly endY: number;
}

function curvePath(curve: FanCurve): string {
  return [
    `M ${round(curve.startX)} ${round(curve.startY)}`,
    `C ${round(curve.controlOneX)} ${round(curve.controlOneY)} ${round(curve.controlTwoX)} ${round(curve.controlTwoY)} ${round(curve.middleX)} ${round(curve.middleY)}`,
    `C ${round(curve.controlThreeX)} ${round(curve.controlThreeY)} ${round(curve.controlFourX)} ${round(curve.controlFourY)} ${round(curve.endX)} ${round(curve.endY)}`,
  ].join(" ");
}

function morphCurve(curve: FanCurve, amount: number, phase: number): FanCurve {
  const first = Math.sin(phase) * amount;
  const second = Math.sin(phase + Math.PI * 0.72) * amount;
  const third = Math.sin(phase + Math.PI * 1.36) * amount;
  return {
    ...curve,
    controlOneX: curve.controlOneX + first * 0.24,
    controlOneY: curve.controlOneY + first,
    controlTwoX: curve.controlTwoX - second * 0.2,
    controlTwoY: curve.controlTwoY + second,
    middleX: curve.middleX + second * 0.16,
    middleY: curve.middleY + second * 0.72,
    controlThreeX: curve.controlThreeX + third * 0.18,
    controlThreeY: curve.controlThreeY + third,
    controlFourX: curve.controlFourX - first * 0.14,
    controlFourY: curve.controlFourY + first * 0.62,
  };
}

function createFanCurve(index: number, lineCount: number, density: number, random: () => number): FanCurve {
  const position = lineCount === 1 ? 0.5 : index / (lineCount - 1);
  const spacing = 0.72 + density * 0.28;
  const jitter = () => random() - 0.5;
  const startX = -210 + position * 570 * spacing + jitter() * 72;
  const startY = 730 + jitter() * 54;
  const middleX = 310 + position * 430 * spacing + jitter() * 62;
  const middleY = 420 - position * 210 + jitter() * 46;
  const endX = 650 + position * 720 * spacing + jitter() * 88;
  const endY = -105 + jitter() * 78;

  return {
    startX,
    startY,
    controlOneX: startX + 86 + random() * 118,
    controlOneY: 620 - position * 62 + jitter() * 44,
    controlTwoX: middleX - 170 - random() * 80,
    controlTwoY: middleY + 105 + jitter() * 54,
    middleX,
    middleY,
    controlThreeX: middleX + 160 + random() * 116,
    controlThreeY: middleY - 118 + jitter() * 56,
    controlFourX: endX - 145 - random() * 110,
    controlFourY: 85 + position * 58 + jitter() * 48,
    endX,
    endY,
  };
}

function generatePaths(config: NormalizedAnimatedLineConfig): readonly AnimatedLinePathDefinition[] {
  const random = seededRandom(seedHash(config.seed));
  const featureLineIndexes = config.lineCount >= 10
    ? new Set([
        Math.floor(config.lineCount * 0.2),
        Math.floor(config.lineCount * 0.53),
        Math.floor(config.lineCount * 0.8),
      ])
    : new Set<number>();

  return Array.from({ length: config.lineCount }, (_, index) => {
    const curve = createFanCurve(index, config.lineCount, config.density, random);
    const phase = index * 0.54 + random() * 0.3;
    const waveAmount = config.waveAmplitude * (0.76 + random() * 0.42);
    const d = curvePath(curve);
    const waveOne = curvePath(morphCurve(curve, waveAmount, phase));
    const waveTwo = curvePath(morphCurve(curve, waveAmount, phase + Math.PI * 0.95));
    const strokeWidthScale = featureLineIndexes.has(index)
      ? 2.05 + random() * 0.65
      : 0.42 + random() * 1.05;
    const strokeWidth = config.strokeWidth * strokeWidthScale;
    const opacity = 0.58 + random() * 0.4;
    const durationSeconds = config.speed * (0.88 + random() * 0.24);
    const accentLength = 0.08 + random() * 0.18;
    const accentGap = Math.max(0.22, 1 - accentLength);
    const accentStart = 0.05 + random() * 0.72;
    const phaseDelaySeconds = -(config.speed * (index / config.lineCount));

    return {
      d,
      morphValues: `${d};${waveOne};${waveTwo};${d}`,
      strokeWidth,
      opacity,
      phaseDelaySeconds,
      durationSeconds,
      driftX: config.drift * (3 + random() * 6),
      driftY: config.drift * (3 + random() * 7),
      accentDash: `${accentLength.toFixed(3)} ${accentGap.toFixed(3)}`,
      accentOffset: `${accentStart.toFixed(3)}`,
      hasAccent: index % 2 === 0 || random() > 0.46,
      useAccentTone: index % 3 === 1 || random() > 0.84,
    };
  });
}

export function generateAnimatedLinePaths(props: AnimatedLineBackgroundProps = {}): readonly AnimatedLinePathDefinition[] {
  return generatePaths(normalizeAnimatedLineConfig(props));
}

function directionTransform(direction: AnimatedLineDirection): string | undefined {
  if (direction === "right-to-left") return `translate(${VIEWBOX_WIDTH} 0) scale(-1 1)`;
  if (direction === "upward") return `rotate(-90 ${VIEWBOX_WIDTH / 2} ${VIEWBOX_HEIGHT / 2})`;
  if (direction === "downward") return `rotate(90 ${VIEWBOX_WIDTH / 2} ${VIEWBOX_HEIGHT / 2})`;
  return undefined;
}

function MorphAnimation({ path }: { readonly path: AnimatedLinePathDefinition }) {
  return <animate
    className="animated-line-background__morph"
    attributeName="d"
    values={path.morphValues}
    dur={`${path.durationSeconds.toFixed(2)}s`}
    begin={`${path.phaseDelaySeconds.toFixed(2)}s`}
    repeatCount="indefinite"
    calcMode="spline"
    keyTimes="0;0.33;0.66;1"
    keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
  />;
}

export function AnimatedLineBackground({ className, ...props }: AnimatedLineBackgroundProps) {
  const config = normalizeAnimatedLineConfig(props);
  const paths = generatePaths(config);
  const directionSign = config.direction === "right-to-left" || config.direction === "upward" ? -1 : 1;
  const rootClassName = ["animated-line-background", className].filter(Boolean).join(" ");
  const rootStyle: AnimatedLineStyle = {
    "--animated-line-opacity": config.opacity,
    "--animated-line-scale": config.scale,
    "--animated-line-speed": `${config.speed}s`,
    "--animated-line-density": config.density,
    "--animated-line-drift": config.drift,
    "--animated-line-pulse-strength": config.pulseStrength,
    "--animated-line-color": config.color,
    "--animated-line-accent-color": config.accentColor,
    "--animated-line-direction-sign": directionSign,
  };

  return <svg
    className={rootClassName}
    viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
    preserveAspectRatio="none"
    aria-hidden="true"
    focusable="false"
    pointerEvents="none"
    data-line-count={config.lineCount}
    data-direction={config.direction}
    data-seed={String(config.seed)}
    style={rootStyle}
  >
    <g className="animated-line-background__geometry" transform={directionTransform(config.direction)}>
      {paths.map((path, index) => {
        const lineStyle: AnimatedLineStyle = {
          "--animated-line-delay": `${path.phaseDelaySeconds.toFixed(2)}s`,
          "--animated-line-duration": `${path.durationSeconds.toFixed(2)}s`,
          "--animated-line-line-opacity": path.opacity,
          "--animated-line-stroke-width": path.strokeWidth,
          "--animated-line-drift-x": `${path.driftX.toFixed(2)}px`,
          "--animated-line-drift-y": `${path.driftY.toFixed(2)}px`,
          "--animated-line-accent-dash": path.accentDash,
          "--animated-line-accent-offset": path.accentOffset,
          "--animated-line-path-color": path.useAccentTone ? config.accentColor : config.color,
        };

        return <g className="animated-line-background__line" key={`${config.seed}-${index}`} style={lineStyle}>
          <path className="animated-line-background__path animated-line-background__animated-path" d={path.d}>
            <MorphAnimation path={path} />
          </path>
          <path className="animated-line-background__path animated-line-background__static-path" d={path.d} />
          {path.hasAccent ? <>
            <path
              className="animated-line-background__accent animated-line-background__animated-path"
              d={path.d}
              pathLength={1}
              strokeDasharray={path.accentDash}
              strokeDashoffset={path.accentOffset}
            >
              <MorphAnimation path={path} />
            </path>
            <path
              className="animated-line-background__accent animated-line-background__static-path"
              d={path.d}
              pathLength={1}
              strokeDasharray={path.accentDash}
              strokeDashoffset={path.accentOffset}
            />
          </> : null}
        </g>;
      })}
    </g>
    <image
      className="animated-line-background__mobile-art"
      href="/brand/back-lines.svg"
      x="0"
      y="0"
      width="100%"
      height="100%"
      preserveAspectRatio="xMaxYMax slice"
    />
  </svg>;
}
