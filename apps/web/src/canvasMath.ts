export type Point = { x: number; y: number };
export type Viewport = { x: number; y: number; scale: number };

export const minCanvasScale = 0.25;
export const maxCanvasScale = 2.5;

export const clampScale = (scale: number) =>
  Math.min(maxCanvasScale, Math.max(minCanvasScale, scale));

export const screenToWorld = (point: Point, viewport: Viewport): Point => ({
  x: (point.x - viewport.x) / viewport.scale,
  y: (point.y - viewport.y) / viewport.scale,
});

export const worldToScreen = (point: Point, viewport: Viewport): Point => ({
  x: point.x * viewport.scale + viewport.x,
  y: point.y * viewport.scale + viewport.y,
});

export const zoomViewportAtPoint = (
  viewport: Viewport,
  screenAnchor: Point,
  nextScale: number,
): Viewport => {
  const scale = clampScale(nextScale);
  const worldAnchor = screenToWorld(screenAnchor, viewport);

  return {
    x: screenAnchor.x - worldAnchor.x * scale,
    y: screenAnchor.y - worldAnchor.y * scale,
    scale,
  };
};
