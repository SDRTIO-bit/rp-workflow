import type { CSSProperties } from "react";

export const nodeDelayMs = (index: number) => 60 + index * 40;

export const edgeDelayMs = (index: number) => 120 + index * 60;

export const motionStyle = (property: `--${string}`, delayMs: number): CSSProperties =>
  ({
    [property]: `${delayMs}ms`,
  }) as CSSProperties;
