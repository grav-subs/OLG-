import React, { useEffect, useRef, useState } from 'react';
import p5 from 'p5';
import { PenConfig, VectorStroke, BezierAnchor, StrokePoint } from '../types';
import { generateSvgString } from '../utils/svgExporter';

// Ramer-Douglas-Peucker simplification helper functions
function getSqDist(p1: StrokePoint, p2: StrokePoint): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return dx * dx + dy * dy;
}

function getSqSegDist(p: StrokePoint, p1: StrokePoint, p2: StrokePoint): number {
  let x = p1.x;
  let y = p1.y;
  let dx = p2.x - x;
  let dy = p2.y - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2.x;
      y = p2.y;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = p.x - x;
  dy = p.y - y;
  return dx * dx + dy * dy;
}

function simplifyRadialDist(points: StrokePoint[], sqTolerance: number): StrokePoint[] {
  let prevPoint = points[0];
  const newPoints = [prevPoint];
  let point;

  for (let i = 1, len = points.length; i < len; i++) {
    point = points[i];
    if (getSqDist(point, prevPoint) > sqTolerance) {
      newPoints.push(point);
      prevPoint = point;
    }
  }

  if (prevPoint !== points[points.length - 1]) {
    newPoints.push(points[points.length - 1]);
  }
  return newPoints;
}

function simplifyDPStep(points: StrokePoint[], first: number, last: number, sqTolerance: number, simplified: StrokePoint[]) {
  let maxSqDist = sqTolerance;
  let index = -1;

  for (let i = first + 1; i < last; i++) {
    const sqDist = getSqSegDist(points[i], points[first], points[last]);
    if (sqDist > maxSqDist) {
      index = i;
      maxSqDist = sqDist;
    }
  }

  if (index !== -1) {
    if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
    simplified.push(points[index]);
    if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
  }
}

function simplifyDouglasPeucker(points: StrokePoint[], sqTolerance: number): StrokePoint[] {
  const last = points.length - 1;
  const simplified = [points[0]];
  simplifyDPStep(points, 0, last, sqTolerance, simplified);
  simplified.push(points[last]);
  return simplified;
}

function simplifyPoints(points: StrokePoint[], tolerance: number): StrokePoint[] {
  if (points.length <= 2) return points;
  const sqTolerance = tolerance * tolerance;
  const radialSimplified = simplifyRadialDist(points, sqTolerance);
  return simplifyDouglasPeucker(radialSimplified, sqTolerance);
}

// Weighted moving average filter to smooth raw coordinates and round out sharp turns/angles
function movingAverageSmooth(points: StrokePoint[], windowSize: number = 5): StrokePoint[] {
  if (points.length <= 2) return points;
  
  const smoothed: StrokePoint[] = [];
  const n = points.length;
  const half = Math.floor(windowSize / 2);

  for (let i = 0; i < n; i++) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (let w = -half; w <= half; w++) {
      const idx = i + w;
      if (idx >= 0 && idx < n) {
        // Linear distance weights for a nice triangular filter
        const weight = 1 - Math.abs(w) / (half + 1);
        sumX += points[idx].x * weight;
        sumY += points[idx].y * weight;
        count += weight;
      }
    }

    smoothed.push({
      x: sumX / count,
      y: sumY / count
    });
  }

  return smoothed;
}

// Uniformly resample points along the path to distribute curvature perfectly and avoid flat spots/rigid edges
function resamplePoints(points: StrokePoint[], spacing: number): StrokePoint[] {
  if (points.length <= 1) return points;
  const resampled: StrokePoint[] = [{ x: points[0].x, y: points[0].y }];
  let prev = points[0];
  let accumDist = 0;

  for (let i = 1; i < points.length; i++) {
    const curr = points[i];
    const d = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if (d === 0) continue;

    if (accumDist + d >= spacing) {
      let t = (spacing - accumDist) / d;
      let x = prev.x + t * (curr.x - prev.x);
      let y = prev.y + t * (curr.y - prev.y);
      resampled.push({ x, y });
      
      let remainingDist = d - (spacing - accumDist);
      let px = x;
      let py = y;
      while (remainingDist >= spacing) {
        x = px + (spacing / remainingDist) * (curr.x - px);
        y = py + (spacing / remainingDist) * (curr.y - py);
        resampled.push({ x, y });
        remainingDist -= spacing;
        px = x;
        py = y;
      }
      accumDist = remainingDist;
    } else {
      accumDist += d;
    }
    prev = curr;
  }

  // Ensure last point is exactly matched
  const lastPoint = points[points.length - 1];
  const lastResampled = resampled[resampled.length - 1];
  if (Math.hypot(lastPoint.x - lastResampled.x, lastPoint.y - lastResampled.y) > spacing * 0.3) {
    resampled.push({ x: lastPoint.x, y: lastPoint.y });
  } else if (resampled.length > 1) {
    resampled[resampled.length - 1] = { x: lastPoint.x, y: lastPoint.y };
  }

  return resampled;
}

// Convert discrete points to a smooth BezierAnchor path using angle-bisector Catmull-Rom tangent vectors
function computeControlPoints(
  points: StrokePoint[],
  isClosed: boolean = false,
  tension: number = 0.45,
  existingAnchors?: BezierAnchor[]
): BezierAnchor[] {
  const anchors: BezierAnchor[] = [];
  const n = points.length;
  if (n === 0) return [];

  for (let i = 0; i < n; i++) {
    anchors.push({
      p: { x: points[i].x, y: points[i].y },
      c1: { x: points[i].x, y: points[i].y },
      c2: { x: points[i].x, y: points[i].y }
    });
  }

  if (n <= 1) return anchors;

  if (isClosed && n > 2) {
    for (let i = 0; i < n; i++) {
      if (existingAnchors && existingAnchors[i] && existingAnchors[i].isManuallyAdjusted) {
        anchors[i].c1 = existingAnchors[i].c1 ? { ...existingAnchors[i].c1! } : anchors[i].c1;
        anchors[i].c2 = existingAnchors[i].c2 ? { ...existingAnchors[i].c2! } : anchors[i].c2;
        anchors[i].isManuallyAdjusted = true;
        continue;
      }

      const pCurrent = points[i];
      const pPrev = points[(i - 1 + n) % n];
      const pNext = points[(i + 1) % n];

      const v1x = pPrev.x - pCurrent.x;
      const v1y = pPrev.y - pCurrent.y;
      const v2x = pNext.x - pCurrent.x;
      const v2y = pNext.y - pCurrent.y;

      const d1 = Math.hypot(v1x, v1y);
      const d2 = Math.hypot(v2x, v2y);

      if (d1 === 0 || d2 === 0) continue;

      const u1x = v1x / d1;
      const u1y = v1y / d1;
      const u2x = v2x / d2;
      const u2y = v2y / d2;

      // Tangent parallel to u2 - u1 to perfectly bisect the angle
      let tx = u2x - u1x;
      let ty = u2y - u1y;
      const tLen = Math.hypot(tx, ty);
      if (tLen > 0) {
        tx /= tLen;
        ty /= tLen;
      }

      anchors[i].c1 = {
        x: pCurrent.x - tx * d1 * tension,
        y: pCurrent.y - ty * d1 * tension
      };

      anchors[i].c2 = {
        x: pCurrent.x + tx * d2 * tension,
        y: pCurrent.y + ty * d2 * tension
      };
    }
  } else {
    // Open path
    for (let i = 1; i < n - 1; i++) {
      if (existingAnchors && existingAnchors[i] && existingAnchors[i].isManuallyAdjusted) {
        anchors[i].c1 = existingAnchors[i].c1 ? { ...existingAnchors[i].c1! } : anchors[i].c1;
        anchors[i].c2 = existingAnchors[i].c2 ? { ...existingAnchors[i].c2! } : anchors[i].c2;
        anchors[i].isManuallyAdjusted = true;
        continue;
      }

      const pCurrent = points[i];
      const pPrev = points[i - 1];
      const pNext = points[i + 1];

      const v1x = pPrev.x - pCurrent.x;
      const v1y = pPrev.y - pCurrent.y;
      const v2x = pNext.x - pCurrent.x;
      const v2y = pNext.y - pCurrent.y;

      const d1 = Math.hypot(v1x, v1y);
      const d2 = Math.hypot(v2x, v2y);

      if (d1 === 0 || d2 === 0) continue;

      const u1x = v1x / d1;
      const u1y = v1y / d1;
      const u2x = v2x / d2;
      const u2y = v2y / d2;

      let tx = u2x - u1x;
      let ty = u2y - u1y;
      const tLen = Math.hypot(tx, ty);
      if (tLen > 0) {
        tx /= tLen;
        ty /= tLen;
      }

      anchors[i].c1 = {
        x: pCurrent.x - tx * d1 * tension,
        y: pCurrent.y - ty * d1 * tension
      };

      anchors[i].c2 = {
        x: pCurrent.x + tx * d2 * tension,
        y: pCurrent.y + ty * d2 * tension
      };
    }

    // Set endpoints control points correctly pointing to neighbors
    if (n > 1) {
      // First anchor
      if (existingAnchors && existingAnchors[0] && existingAnchors[0].isManuallyAdjusted) {
        anchors[0].c1 = existingAnchors[0].c1 ? { ...existingAnchors[0].c1! } : anchors[0].c1;
        anchors[0].c2 = existingAnchors[0].c2 ? { ...existingAnchors[0].c2! } : anchors[0].c2;
        anchors[0].isManuallyAdjusted = true;
      } else {
        anchors[0].c1 = { x: anchors[0].p.x, y: anchors[0].p.y };
        const d01 = Math.hypot(anchors[1].p.x - anchors[0].p.x, anchors[1].p.y - anchors[0].p.y);
        let dx0 = anchors[1].p.x - anchors[0].p.x;
        let dy0 = anchors[1].p.y - anchors[0].p.y;
        if (d01 > 0) {
          dx0 /= d01;
          dy0 /= d01;
        }
        anchors[0].c2 = {
          x: anchors[0].p.x + dx0 * d01 * tension,
          y: anchors[0].p.y + dy0 * d01 * tension
        };
      }

      // Last anchor
      if (existingAnchors && existingAnchors[n - 1] && existingAnchors[n - 1].isManuallyAdjusted) {
        anchors[n - 1].c1 = existingAnchors[n - 1].c1 ? { ...existingAnchors[n - 1].c1! } : anchors[n - 1].c1;
        anchors[n - 1].c2 = existingAnchors[n - 1].c2 ? { ...existingAnchors[n - 1].c2! } : anchors[n - 1].c2;
        anchors[n - 1].isManuallyAdjusted = true;
      } else {
        anchors[n - 1].c2 = { x: anchors[n - 1].p.x, y: anchors[n - 1].p.y };
        const dN1 = Math.hypot(anchors[n - 1].p.x - anchors[n - 2].p.x, anchors[n - 1].p.y - anchors[n - 2].p.y);
        let dxN = anchors[n - 1].p.x - anchors[n - 2].p.x;
        let dyN = anchors[n - 1].p.y - anchors[n - 2].p.y;
        if (dN1 > 0) {
          dxN /= dN1;
          dyN /= dN1;
        }
        anchors[n - 1].c1 = {
          x: anchors[n - 1].p.x - dxN * dN1 * tension,
          y: anchors[n - 1].p.y - dyN * dN1 * tension
        };
      }
    }
  }

  return anchors;
}

interface CalligraphyCanvasProps {
  config: PenConfig;
  setClearTrigger: React.Dispatch<React.SetStateAction<boolean>>;
  clearTrigger: boolean;
  setDownloadTrigger: React.Dispatch<React.SetStateAction<boolean>>;
  downloadTrigger: boolean;
  
  downloadSvgTrigger?: boolean;
  setDownloadSvgTrigger?: React.Dispatch<React.SetStateAction<boolean>>;
  copySvgTrigger?: boolean;
  setCopySvgTrigger?: React.Dispatch<React.SetStateAction<boolean>>;
  onShowNotification?: (message: string, type: 'success' | 'error') => void;

  undoTrigger: boolean;
  setUndoTrigger: React.Dispatch<React.SetStateAction<boolean>>;
  redoTrigger: boolean;
  setRedoTrigger: React.Dispatch<React.SetStateAction<boolean>>;
  deleteTrigger: boolean;
  setDeleteTrigger: React.Dispatch<React.SetStateAction<boolean>>;
  copyTrigger: boolean;
  setCopyTrigger: React.Dispatch<React.SetStateAction<boolean>>;
  finishPathTrigger: boolean;
  setFinishPathTrigger: React.Dispatch<React.SetStateAction<boolean>>;
  shapePreviewTrigger: { simplify: number; smooth: number } | null;
  setShapePreviewTrigger: React.Dispatch<React.SetStateAction<{ simplify: number; smooth: number } | null>>;
  shapeCommitTrigger: boolean;
  setShapeCommitTrigger: React.Dispatch<React.SetStateAction<boolean>>;
  toggleClosedTrigger?: boolean;
  setToggleClosedTrigger?: React.Dispatch<React.SetStateAction<boolean>>;

  onSelectedShapeParamsChange?: (params: { simplify: number; smooth: number } | null) => void;

  referenceOpacity?: number;
  referenceLocked?: boolean;
  removeReferenceTrigger?: boolean;
  setRemoveReferenceTrigger?: React.Dispatch<React.SetStateAction<boolean>>;
  referenceImageRequest?: { dataUrl: string } | null;
  importStrokesRequest?: { strokes: VectorStroke[] } | null;
}

const CalligraphyCanvas: React.FC<CalligraphyCanvasProps> = ({ 
  config, 
  clearTrigger, 
  setClearTrigger,
  downloadTrigger,
  setDownloadTrigger,
  downloadSvgTrigger = false,
  setDownloadSvgTrigger,
  copySvgTrigger = false,
  setCopySvgTrigger,
  onShowNotification,
  undoTrigger,
  setUndoTrigger,
  redoTrigger,
  setRedoTrigger,
  deleteTrigger,
  setDeleteTrigger,
  copyTrigger,
  setCopyTrigger,
  finishPathTrigger,
  setFinishPathTrigger,
  shapePreviewTrigger,
  setShapePreviewTrigger,
  shapeCommitTrigger,
  setShapeCommitTrigger,
  toggleClosedTrigger,
  setToggleClosedTrigger,
  onSelectedShapeParamsChange,
  referenceOpacity = 0.5,
  referenceLocked = false,
  removeReferenceTrigger = false,
  setRemoveReferenceTrigger,
  referenceImageRequest,
  importStrokesRequest
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const p5Instance = useRef<p5 | null>(null);
  const onSelectedShapeParamsChangeRef = useRef(onSelectedShapeParamsChange);
  // setIsSpaceHeld's identity is stable across renders, so the once-mounted p5 sketch
  // below can call it directly without needing a ref to dodge stale closures.
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);

  useEffect(() => {
    onSelectedShapeParamsChangeRef.current = onSelectedShapeParamsChange;
  }, [onSelectedShapeParamsChange]);
  const configRef = useRef(config);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    if (!containerRef.current) return;

    const sketch = (p: p5) => {
      let strokes: VectorStroke[] = [];
      let history: VectorStroke[][] = [[]];
      let historyIndex = 0;

      // Auto-save: persists strokes to this browser only (no accounts/cloud sync — a
      // reload on the same device recovers your work; switching devices does not).
      const AUTOSAVE_KEY = 'digital-calligraphy-studio:strokes-v1';
      const persistStrokes = () => {
        try {
          localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(strokes));
        } catch {
          // Storage unavailable (private browsing, quota exceeded, etc.) — not critical
        }
      };

      let activeStroke: VectorStroke | null = null;
      let selectedStroke: VectorStroke | null = null;
      let hoveredStroke: VectorStroke | null = null;

      // Detects selection changes (however they happen — click, undo/redo, finishing a
      // path, deselecting) so the parent can sync the Simplify/Smooth sliders to whichever
      // stroke is now selected, instead of leaving them at whatever a previously selected
      // stroke was left at.
      let lastNotifiedStrokeId: string | null | undefined = undefined;

      // Copy/paste clipboard — holds a deep copy of the last-copied selection (one or more strokes)
      let clipboard: VectorStroke[] = [];
      let pasteOffsetCount = 0;

      // Anchors popped off an in-progress bezier path by undo, so redo can restore them
      // one at a time. A whole in-progress path is never a single undo step — undo/redo
      // walk it point by point until it's committed (closed or finished).
      let pendingAnchorRedo: BezierAnchor[] = [];

      let isDrawing = false;
      let prevMouse: p5.Vector | null = null;
      let smoothedMouse: p5.Vector | null = null;

      // Direct selection drag state
      let draggingItem: {
        strokeId: string;
        type: 'anchor' | 'control1' | 'control2' | 'stroke' | 'rotate';
        index: number;
      } | null = null;

      // Rotation drag state: anchors are rotated from this snapshot each frame (not
      // incrementally re-rotated frame-to-frame) so repeated small rotations never drift.
      let rotatePivot: StrokePoint | null = null;
      let rotateStartAngle = 0;
      let rotateSnapshot: BezierAnchor[] = [];

      // Bounding box over a stroke's anchor points (control handles ignored — close enough
      // for placing the rotate handle, and avoids the box jittering with handle adjustments)
      const getStrokeBounds = (stroke: VectorStroke): { minX: number; minY: number; maxX: number; maxY: number } | null => {
        if (!stroke.anchors || stroke.anchors.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const a of stroke.anchors) {
          minX = Math.min(minX, a.p.x);
          minY = Math.min(minY, a.p.y);
          maxX = Math.max(maxX, a.p.x);
          maxY = Math.max(maxY, a.p.y);
        }
        return { minX, minY, maxX, maxY };
      };

      // Where the rotate handle sits for a stroke: a fixed screen-space distance above the
      // bounding box's top-center, so it stays reachable regardless of zoom level.
      const ROTATE_HANDLE_OFFSET = 32;
      const getRotateHandlePos = (stroke: VectorStroke, zoomLevel: number): StrokePoint | null => {
        const b = getStrokeBounds(stroke);
        if (!b) return null;
        return { x: (b.minX + b.maxX) / 2, y: b.minY - ROTATE_HANDLE_OFFSET / zoomLevel };
      };

      // Multi-anchor selection state (Figma & Illustrator style)
      interface SelectedAnchor {
        strokeId: string;
        index: number;
      }
      let selectedAnchors: SelectedAnchor[] = [];
      let marqueeStart: p5.Vector | null = null;
      let isMarqueeDragging = false;

      // Multi-shape selection (shift-click or marquee-drag over empty space). `selectedStroke`
      // remains the "primary" shape — the one whose anchors/rotate handle/Simplify & Smooth
      // amounts show, since those stay single-shape-only by design. `selectedStrokes` is the
      // full set that Copy, Delete, and dragging-to-move act on together.
      let selectedStrokes: VectorStroke[] = [];

      const isStrokeSelected = (id: string): boolean => selectedStrokes.some(s => s.id === id);

      const setSingleSelection = (stroke: VectorStroke | null) => {
        selectedStroke = stroke;
        selectedStrokes = stroke ? [stroke] : [];
      };

      const toggleStrokeSelection = (stroke: VectorStroke) => {
        const idx = selectedStrokes.findIndex(s => s.id === stroke.id);
        if (idx !== -1) {
          selectedStrokes.splice(idx, 1);
          selectedStroke = selectedStrokes.length > 0 ? selectedStrokes[selectedStrokes.length - 1] : null;
        } else {
          selectedStrokes.push(stroke);
          selectedStroke = stroke;
        }
      };

      // Canvas pan (Move/Hand tool) state
      let panX = 0;
      let panY = 0;
      let isPanning = false;
      let panStartMouse: p5.Vector | null = null;
      let panStartOffset: { x: number; y: number } | null = null;

      // Holding Space temporarily activates panning regardless of the active tool (same
      // convention as Photoshop/Figma/Illustrator) — the fix for content or a reference
      // image ending up stuck off in a corner with no way to bring it back into view.
      let spacePanHeld = false;

      // Canvas zoom. Scales the actual drawing coordinate space (via p.scale in draw()),
      // not a CSS transform on the canvas element — so strokes stay crisp vector redraws
      // at any zoom level instead of a blurred raster upscale.
      let zoom = 1;
      const MIN_ZOOM = 0.1;
      const MAX_ZOOM = 8;

      // Convert current screen-space mouse position to world-space (accounting for pan + zoom)
      const getWorldMouse = () => ({ x: (p.mouseX - panX) / zoom, y: (p.mouseY - panY) / zoom });

      // Zoom by `factor`, keeping the world point under (anchorX, anchorY) visually fixed
      const applyZoom = (factor: number, anchorX: number, anchorY: number) => {
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
        const wx = (anchorX - panX) / zoom;
        const wy = (anchorY - panY) / zoom;
        panX = anchorX - wx * newZoom;
        panY = anchorY - wy * newZoom;
        zoom = newZoom;
      };

      // Reference/trace image (Figma-style light-table overlay) — one at a time, positioned
      // in world space so it pans/zooms with the canvas. Lives outside the undo/redo stroke
      // history entirely: folding a base64 image into every history snapshot would bloat
      // each one, and there's little value undoing a move/resize of a tracing guide anyway.
      interface ReferenceImageState {
        img: p5.Image;
        x: number;
        y: number;
        width: number;
        height: number;
        opacity: number;
        locked: boolean;
      }
      let referenceImage: ReferenceImageState | null = null;
      let isDraggingReference = false;
      let isResizingReference = false;
      let referenceDragPrevMouse: StrokePoint | null = null;

      const REFERENCE_HANDLE_SIZE = 14;

      const getReferenceHandlePos = (ref: ReferenceImageState): StrokePoint => ({
        x: ref.x + ref.width,
        y: ref.y + ref.height
      });

      // Pristine anchor snapshot per stroke id, shared by the Simplify and Smooth sliders.
      // Captured once (lazily) and never overwritten by either slider, so both always
      // recompute from the same untouched original — dragging either back to 0 exactly
      // restores it, and using one can never compound on top of, or erase, the other's
      // effect. Manual edits (dragging a point, deleting an anchor) invalidate a stroke's
      // entry so a later slider touch starts fresh from the shape as the user left it,
      // instead of silently reverting a deliberate edit back to stale cached geometry.
      const originalAnchors = new Map<string, StrokePoint[]>();

      const getOriginalPoints = (stroke: VectorStroke): StrokePoint[] => {
        if (!originalAnchors.has(stroke.id)) {
          originalAnchors.set(stroke.id, stroke.anchors!.map(a => ({ x: a.p.x, y: a.p.y })));
        }
        return originalAnchors.get(stroke.id)!;
      };

      p.setup = () => {
        p.createCanvas(p.windowWidth, p.windowHeight);

        try {
          const saved = localStorage.getItem(AUTOSAVE_KEY);
          if (saved) {
            const restored = JSON.parse(saved);
            if (Array.isArray(restored) && restored.length > 0) {
              strokes = restored;
              // history[0] stays the empty canvas so Undo can still get back to a blank
              // slate; history[1] is what was restored, and that's the current state.
              history = [[], JSON.parse(JSON.stringify(strokes))];
              historyIndex = 1;
            }
          }
        } catch {
          // Corrupt or unavailable storage — just start with an empty canvas
        }
      };

      p.windowResized = () => {
        p.resizeCanvas(p.windowWidth, p.windowHeight);
      };

      // History state helper
      const saveState = () => {
        if (historyIndex < history.length - 1) {
          history = history.slice(0, historyIndex + 1);
        }
        history.push(JSON.parse(JSON.stringify(strokes)));
        historyIndex = history.length - 1;
        pendingAnchorRedo = [];
        persistStrokes();
      };

      interface SnapGuide {
        type: 'h' | 'v';
        val: number;
        refX: number;
        refY: number;
      }

      let activeSnapPoint: StrokePoint | null = null;
      let activeSnapGuides: SnapGuide[] = [];

      // Gather eligible snap targets from all other strokes and anchors
      const getSnapTargets = (excludeStrokeId?: string, excludeAnchorIndex?: number): StrokePoint[] => {
        const targets: StrokePoint[] = [];
        
        // Add anchors from completed strokes
        for (const stroke of strokes) {
          if (stroke.tool === 'bezier' && stroke.anchors) {
            for (let i = 0; i < stroke.anchors.length; i++) {
              if (stroke.id === excludeStrokeId && i === excludeAnchorIndex) {
                continue;
              }
              targets.push({ x: stroke.anchors[i].p.x, y: stroke.anchors[i].p.y });
            }
          }
        }
        
        // Add anchors from active stroke
        if (activeStroke && activeStroke.tool === 'bezier' && activeStroke.anchors) {
          for (let i = 0; i < activeStroke.anchors.length; i++) {
            if (activeStroke.id === excludeStrokeId && i === excludeAnchorIndex) {
              continue;
            }
            targets.push({ x: activeStroke.anchors[i].p.x, y: activeStroke.anchors[i].p.y });
          }
        }
        
        return targets;
      };

      // Get coordinate possibly snapped to grid, other anchors, or smart guides
      const getPosition = (x: number, y: number): p5.Vector => {
        activeSnapPoint = null;
        activeSnapGuides = [];

        // Exclude the currently dragged anchor if we are dragging one
        let excludeStrokeId: string | undefined;
        let excludeAnchorIndex: number | undefined;
        if (draggingItem && (draggingItem.type === 'anchor' || draggingItem.type === 'control1' || draggingItem.type === 'control2')) {
          excludeStrokeId = draggingItem.strokeId;
          excludeAnchorIndex = draggingItem.index;
        }

        const targets = getSnapTargets(excludeStrokeId, excludeAnchorIndex);

        // 1. Point Snapping (highest priority) - Snap completely if cursor is close to another anchor point
        // Thresholds are defined in screen pixels, so divide by zoom to keep the feel constant
        const pointSnapThreshold = 18 / zoom;
        let bestPoint: StrokePoint | null = null;
        let minDist = Infinity;
        
        for (const target of targets) {
          const d = Math.hypot(x - target.x, y - target.y);
          if (d < pointSnapThreshold && d < minDist) {
            minDist = d;
            bestPoint = target;
          }
        }

        if (bestPoint) {
          activeSnapPoint = bestPoint;
          return p.createVector(bestPoint.x, bestPoint.y);
        }

        // 2. Alignment Snapping (smart alignment guidelines) - Snap cursor's x or y coordinate
        const alignThreshold = 10 / zoom;
        let snappedX = x;
        let snappedY = y;
        let snapXRef: StrokePoint | null = null;
        let snapYRef: StrokePoint | null = null;

        for (const target of targets) {
          // Check vertical alignment (aligning x coordinate to target.x)
          if (Math.abs(x - target.x) < alignThreshold) {
            if (snapXRef === null || Math.abs(x - target.x) < Math.abs(snappedX - snapXRef.x)) {
              snappedX = target.x;
              snapXRef = target;
            }
          }
          // Check horizontal alignment (aligning y coordinate to target.y)
          if (Math.abs(y - target.y) < alignThreshold) {
            if (snapYRef === null || Math.abs(y - target.y) < Math.abs(snappedY - snapYRef.y)) {
              snappedY = target.y;
              snapYRef = target;
            }
          }
        }

        if (snapXRef) {
          activeSnapGuides.push({
            type: 'v',
            val: snapXRef.x,
            refX: snapXRef.x,
            refY: snapXRef.y
          });
        }
        if (snapYRef) {
          activeSnapGuides.push({
            type: 'h',
            val: snapYRef.y,
            refX: snapYRef.x,
            refY: snapYRef.y
          });
        }

        return p.createVector(snappedX, snappedY);
      };

      // Mathematical approximation of distance to Bezier segment
      const distanceToBezierSegment = (px: number, py: number, a1: BezierAnchor, a2: BezierAnchor): number => {
        const steps = 12;
        let minDist = Infinity;
        const p0x = a1.p.x;
        const p0y = a1.p.y;
        const p1x = a1.c2 ? a1.c2.x : a1.p.x;
        const p1y = a1.c2 ? a1.c2.y : a1.p.y;
        const p2x = a2.c1 ? a2.c1.x : a2.p.x;
        const p2y = a2.c1 ? a2.c1.y : a2.p.y;
        const p3x = a2.p.x;
        const p3y = a2.p.y;

        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const mt = 1 - t;
          const x = mt*mt*mt*p0x + 3*mt*mt*t*p1x + 3*mt*t*t*p2x + t*t*t*p3x;
          const y = mt*mt*mt*p0y + 3*mt*mt*t*p1y + 3*mt*t*t*p2y + t*t*t*p3y;
          const d = Math.hypot(px - x, py - y);
          if (d < minDist) {
            minDist = d;
          }
        }
        return minDist;
      };

      // Find the stroke under the mouse
      const getStrokeUnderMouse = (mx: number, my: number): VectorStroke | null => {
        for (let i = strokes.length - 1; i >= 0; i--) {
          const stroke = strokes[i];
          if (stroke.isVisible === false || stroke.isLocked === true) continue;
          // stroke.width is a world-space quantity (correctly grows with zoom); the extra
          // padding is a screen-feel constant, so it's divided by zoom to stay generous but not huge
          const threshold = Math.max(stroke.width / 2, 8 / zoom) + 12 / zoom;

          if (stroke.tool === 'bezier' && stroke.anchors) {
            for (let j = 0; j < stroke.anchors.length - 1; j++) {
              const d = distanceToBezierSegment(mx, my, stroke.anchors[j], stroke.anchors[j+1]);
              if (d < threshold) return stroke;
            }
            if (stroke.isClosed && stroke.anchors.length > 2) {
              const d = distanceToBezierSegment(mx, my, stroke.anchors[stroke.anchors.length - 1], stroke.anchors[0]);
              if (d < threshold) return stroke;
            }
          } else {
            // Freehand / dots
            for (const pt of stroke.points) {
              const d = Math.hypot(mx - pt.x, my - pt.y);
              if (d < threshold) return stroke;
            }
          }
        }
        return null;
      };

      p.draw = () => {
        const currentSelectedId = selectedStroke ? selectedStroke.id : null;
        if (currentSelectedId !== lastNotifiedStrokeId) {
          lastNotifiedStrokeId = currentSelectedId;
          if (onSelectedShapeParamsChangeRef.current) {
            onSelectedShapeParamsChangeRef.current(
              selectedStroke
                ? { simplify: selectedStroke.simplifyAmount ?? 0, smooth: selectedStroke.smoothAmount ?? 0 }
                : null
            );
          }
        }

        if (configRef.current.bgColor === 'transparent') {
          p.background('#ffffff');
        } else {
          p.background(configRef.current.bgColor || '#FFFBF1');
        }

        // Grid removed

        p.push();
        p.translate(panX, panY);
        p.scale(zoom);

        const wm = getWorldMouse();

        // Draw the reference/trace image behind all strokes
        if (referenceImage) {
          p.push();
          p.tint(255, 255, 255, referenceImage.opacity * 255);
          p.image(referenceImage.img, referenceImage.x, referenceImage.y, referenceImage.width, referenceImage.height);
          p.noTint();
          p.pop();

          // Locked images show no drag/resize chrome at all — nothing to interact with
          if (configRef.current.tool === 'select' && !referenceImage.locked) {
            p.push();
            p.noFill();
            p.stroke('rgba(99, 102, 241, 0.6)');
            p.strokeWeight(1.5 / zoom);
            (p.drawingContext as CanvasRenderingContext2D).setLineDash([5 / zoom, 5 / zoom]);
            p.rect(referenceImage.x, referenceImage.y, referenceImage.width, referenceImage.height);
            (p.drawingContext as CanvasRenderingContext2D).setLineDash([]);
            p.pop();

            const handlePos = getReferenceHandlePos(referenceImage);
            p.push();
            p.fill('#ffffff');
            p.stroke('#6366f1');
            p.strokeWeight(2 / zoom);
            p.circle(handlePos.x, handlePos.y, REFERENCE_HANDLE_SIZE / zoom);
            p.pop();
          }
        }

        // Check hover if we are in select tool and not drawing/dragging
        if (configRef.current.tool === 'select' && !isDrawing && !draggingItem) {
          hoveredStroke = getStrokeUnderMouse(wm.x, wm.y);
        } else {
          hoveredStroke = null;
        }

        // Draw all completed strokes
        for (const stroke of strokes) {
          if (stroke.isVisible === false) continue;
          const isSelected = isStrokeSelected(stroke.id);
          const isHovered = hoveredStroke && hoveredStroke.id === stroke.id;

          p.push();

          // Highlight selection or hover
          if (isSelected || isHovered) {
            p.push();
            p.noFill();
            p.strokeWeight(stroke.width + 8 / zoom);
            p.strokeCap(stroke.cap === 'square' ? p.SQUARE : p.ROUND);
            p.strokeJoin(stroke.cap === 'square' ? p.MITER : p.ROUND);
            p.stroke(isSelected ? 'rgba(59, 130, 246, 0.25)' : 'rgba(59, 130, 246, 0.12)'); // blue glow
            
            if (stroke.tool === 'bezier' && stroke.anchors) {
              p.beginShape();
              p.vertex(stroke.anchors[0].p.x, stroke.anchors[0].p.y);
              for (let i = 0; i < stroke.anchors.length - 1; i++) {
                const a1 = stroke.anchors[i];
                const a2 = stroke.anchors[i+1];
                p.bezierVertex(
                  a1.c2 ? a1.c2.x : a1.p.x, a1.c2 ? a1.c2.y : a1.p.y,
                  a2.c1 ? a2.c1.x : a2.p.x, a2.c1 ? a2.c1.y : a2.p.y,
                  a2.p.x, a2.p.y
                );
              }
              if (stroke.isClosed && stroke.anchors.length > 2) {
                const aLast = stroke.anchors[stroke.anchors.length - 1];
                const aFirst = stroke.anchors[0];
                p.bezierVertex(
                  aLast.c2 ? aLast.c2.x : aLast.p.x, aLast.c2 ? aLast.c2.y : aLast.p.y,
                  aFirst.c1 ? aFirst.c1.x : aFirst.p.x, aFirst.c1 ? aFirst.c1.y : aFirst.p.y,
                  aFirst.p.x, aFirst.p.y
                );
                p.endShape(p.CLOSE);
              } else {
                p.endShape();
              }
            } else {
              p.beginShape();
              if (stroke.points.length > 0) {
                p.curveVertex(stroke.points[0].x, stroke.points[0].y);
                for (const pt of stroke.points) p.curveVertex(pt.x, pt.y);
                p.curveVertex(stroke.points[stroke.points.length - 1].x, stroke.points[stroke.points.length - 1].y);
              }
              p.endShape();
            }
            p.pop();
          }

          // Main Stroke Render
          p.noFill();
          p.strokeWeight(stroke.width);
          p.strokeCap(stroke.cap === 'square' ? p.SQUARE : p.ROUND);
          p.strokeJoin(stroke.cap === 'square' ? p.MITER : p.ROUND);
          const c = p.color(stroke.color);
          c.setAlpha(255); // Force 100% ink density (alpha = 255)
          p.stroke(c);

          if (stroke.tool === 'bezier' && stroke.anchors) {
            p.beginShape();
            p.vertex(stroke.anchors[0].p.x, stroke.anchors[0].p.y);
            for (let i = 0; i < stroke.anchors.length - 1; i++) {
              const a1 = stroke.anchors[i];
              const a2 = stroke.anchors[i+1];
              p.bezierVertex(
                a1.c2 ? a1.c2.x : a1.p.x, a1.c2 ? a1.c2.y : a1.p.y,
                a2.c1 ? a2.c1.x : a2.p.x, a2.c1 ? a2.c1.y : a2.p.y,
                a2.p.x, a2.p.y
              );
            }
            if (stroke.isClosed && stroke.anchors.length > 2) {
              const aLast = stroke.anchors[stroke.anchors.length - 1];
              const aFirst = stroke.anchors[0];
              p.bezierVertex(
                aLast.c2 ? aLast.c2.x : aLast.p.x, aLast.c2 ? aLast.c2.y : aLast.p.y,
                aFirst.c1 ? aFirst.c1.x : aFirst.p.x, aFirst.c1 ? aFirst.c1.y : aFirst.p.y,
                aFirst.p.x, aFirst.p.y
              );
              p.endShape(p.CLOSE);
            } else {
              p.endShape();
            }
          } else {
            // Smooth freehand using Catmull-Rom curveVertex
            p.beginShape();
            if (stroke.points.length > 0) {
              p.curveVertex(stroke.points[0].x, stroke.points[0].y);
              for (const pt of stroke.points) {
                p.curveVertex(pt.x, pt.y);
              }
              p.curveVertex(stroke.points[stroke.points.length - 1].x, stroke.points[stroke.points.length - 1].y);
            }
            p.endShape();
          }

          p.pop();
        }

        // Draw active drawing stroke (not yet completed)
        if (activeStroke) {
          p.push();
          p.noFill();
          p.strokeWeight(activeStroke.width);
          p.strokeCap(activeStroke.cap === 'square' ? p.SQUARE : p.ROUND);
          p.strokeJoin(activeStroke.cap === 'square' ? p.MITER : p.ROUND);
          const c = p.color(activeStroke.color);
          c.setAlpha(255); // Force 100% ink density (alpha = 255)
          p.stroke(c);

          if (activeStroke.tool === 'bezier' && activeStroke.anchors) {
            p.beginShape();
            p.vertex(activeStroke.anchors[0].p.x, activeStroke.anchors[0].p.y);
            for (let i = 0; i < activeStroke.anchors.length - 1; i++) {
              const a1 = activeStroke.anchors[i];
              const a2 = activeStroke.anchors[i+1];
              p.bezierVertex(
                a1.c2 ? a1.c2.x : a1.p.x, a1.c2 ? a1.c2.y : a1.p.y,
                a2.c1 ? a2.c1.x : a2.p.x, a2.c1 ? a2.c1.y : a2.p.y,
                a2.p.x, a2.p.y
              );
            }
            p.endShape();

            // Draw elastic preview line to current cursor
            if (activeStroke.anchors.length > 0) {
              p.push();
              p.strokeWeight(1);
              p.stroke('rgba(59, 130, 246, 0.6)');
              const lastA = activeStroke.anchors[activeStroke.anchors.length - 1];
              const cursor = getPosition(wm.x, wm.y);
              p.bezier(
                lastA.p.x, lastA.p.y,
                lastA.c2 ? lastA.c2.x : lastA.p.x, lastA.c2 ? lastA.c2.y : lastA.p.y,
                cursor.x, cursor.y,
                cursor.x, cursor.y
              );
              p.pop();
            }
          } else {
            p.beginShape();
            if (activeStroke.points.length > 0) {
              p.curveVertex(activeStroke.points[0].x, activeStroke.points[0].y);
              for (const pt of activeStroke.points) {
                p.curveVertex(pt.x, pt.y);
              }
              p.curveVertex(activeStroke.points[activeStroke.points.length - 1].x, activeStroke.points[activeStroke.points.length - 1].y);
            }
            p.endShape();
          }
          p.pop();
        }

        // --- Custom Cursor & Interactive Overlay ---
        const cursor = getPosition(wm.x, wm.y);
        const { width, color, tool } = configRef.current;

        if (p.mouseX > 0 && p.mouseX < p.width && p.mouseY > 0 && p.mouseY < p.height) {
          if (tool === 'select') {
            p.push();
            p.translate(cursor.x, cursor.y);
            // Subtle pointer cursor (constant screen size, not ink — stays fixed regardless of zoom)
            p.stroke('#3b82f6');
            p.strokeWeight(2 / zoom);
            p.noFill();
            p.circle(0, 0, 8 / zoom);
            p.pop();
          } else if (tool === 'move') {
            // No drawn overlay; the CSS grab/grabbing cursor communicates the tool
          } else {
            p.push();
            p.translate(cursor.x, cursor.y);
            // Brush / Pen foot footprint
            p.stroke(color);
            p.strokeWeight(1);
            p.noFill();
            p.circle(0, 0, width);
            p.strokeWeight(3);
            p.point(0, 0);
            p.pop();
          }
        }

        // Draw selection anchor handles if in Direct Selection or actively drawing Bezier
        const editStroke = (tool === 'select' || tool === 'bezier') && (selectedStroke || activeStroke);
        if (editStroke) {
          const targetStroke = activeStroke || selectedStroke;
          if (targetStroke && targetStroke.tool === 'bezier' && targetStroke.anchors) {
            p.push();
            for (let i = 0; i < targetStroke.anchors.length; i++) {
              const anchor = targetStroke.anchors[i];
              
              // Check if this anchor is selected
              const isAnchorSelected = selectedAnchors.some(
                sa => sa.strokeId === targetStroke.id && sa.index === i
              ) || (draggingItem && draggingItem.strokeId === targetStroke.id && draggingItem.type === 'anchor' && draggingItem.index === i);

              // Draw handle 1 — sizes divided by zoom so handles stay a constant screen size
              if (anchor.c1 && (anchor.c1.x !== anchor.p.x || anchor.c1.y !== anchor.p.y)) {
                p.stroke('rgba(59, 130, 246, 0.5)');
                p.strokeWeight(1.5 / zoom);
                p.line(anchor.p.x, anchor.p.y, anchor.c1.x, anchor.c1.y);
                p.fill('#ffffff');
                p.stroke('#3b82f6');
                p.circle(anchor.c1.x, anchor.c1.y, 9 / zoom);
              }

              // Draw handle 2
              if (anchor.c2 && (anchor.c2.x !== anchor.p.x || anchor.c2.y !== anchor.p.y)) {
                p.stroke('rgba(59, 130, 246, 0.5)');
                p.strokeWeight(1.5 / zoom);
                p.line(anchor.p.x, anchor.p.y, anchor.c2.x, anchor.c2.y);
                p.fill('#ffffff');
                p.stroke('#3b82f6');
                p.circle(anchor.c2.x, anchor.c2.y, 9 / zoom);
              }

              // Draw anchor point itself (Figma & Illustrator style: hollow when unselected, filled when selected!)
              if (isAnchorSelected) {
                p.fill('#3b82f6');
                p.stroke('#ffffff');
                p.strokeWeight(2.5 / zoom);
                p.circle(anchor.p.x, anchor.p.y, 14 / zoom);
              } else {
                p.fill('#ffffff');
                p.stroke('#3b82f6');
                p.strokeWeight(2.5 / zoom);
                p.circle(anchor.p.x, anchor.p.y, 13 / zoom);
              }

              // Mark index or highlights
              if (i === 0) {
                p.push();
                p.stroke('#3b82f6');
                p.strokeWeight(1.5 / zoom);
                p.fill(isAnchorSelected ? '#3b82f6' : '#ffffff');
                p.rectMode(p.CENTER);
                p.square(anchor.p.x, anchor.p.y, (isAnchorSelected ? 8 : 6) / zoom); // visual square start marker
                p.pop();
              }
            }
            p.pop();
          }
        }

        // Draw the rotate handle for the selected (already-committed) stroke — only in
        // Direct Select mode, never while still placing a bezier path, and only when a
        // single shape is selected (rotate is single-shape-only by design)
        if (tool === 'select' && selectedStrokes.length === 1 && selectedStroke && selectedStroke.tool === 'bezier' && selectedStroke.anchors && selectedStroke.anchors.length > 0) {
          const bounds = getStrokeBounds(selectedStroke);
          const handlePos = getRotateHandlePos(selectedStroke, zoom);
          if (bounds && handlePos) {
            const isRotating = !!draggingItem && draggingItem.strokeId === selectedStroke.id && draggingItem.type === 'rotate';
            const topCenterX = (bounds.minX + bounds.maxX) / 2;
            p.push();
            p.stroke('rgba(59, 130, 246, 0.5)');
            p.strokeWeight(1.5 / zoom);
            p.line(topCenterX, bounds.minY, handlePos.x, handlePos.y);
            p.fill(isRotating ? '#3b82f6' : '#ffffff');
            p.stroke('#3b82f6');
            p.strokeWeight(2 / zoom);
            p.circle(handlePos.x, handlePos.y, 16 / zoom);
            p.pop();
          }
        }

        // Render Smart Magnetic Alignment Guides & Point Snapping Indicators
        // (all sizes/weights/dash lengths divided by zoom to stay a constant screen size)
        if (activeSnapGuides.length > 0) {
          p.push();
          p.stroke('#6366f1'); // Premium Indigo-500 color for smart guides
          p.strokeWeight(1.2 / zoom);
          // Set a dash pattern: 5px line, 5px space
          (p.drawingContext as CanvasRenderingContext2D).setLineDash([5 / zoom, 5 / zoom]);

          for (const guide of activeSnapGuides) {
            if (guide.type === 'v') {
              // Draw line from reference anchor to current cursor
              p.line(guide.refX, guide.refY, guide.val, cursor.y);

              // Draw a tiny alignment indicator on the reference anchor
              p.push();
              p.noStroke();
              p.fill('rgba(99, 102, 241, 0.25)');
              p.circle(guide.refX, guide.refY, 18 / zoom);
              p.pop();
            } else if (guide.type === 'h') {
              // Draw line from reference anchor to current cursor
              p.line(guide.refX, guide.refY, cursor.x, guide.val);

              // Draw a tiny alignment indicator on the reference anchor
              p.push();
              p.noStroke();
              p.fill('rgba(99, 102, 241, 0.25)');
              p.circle(guide.refX, guide.refY, 18 / zoom);
              p.pop();
            }
          }
          // Reset dash pattern
          (p.drawingContext as CanvasRenderingContext2D).setLineDash([]);
          p.pop();
        }

        if (activeSnapPoint) {
          p.push();
          p.noFill();
          p.stroke('#ec4899'); // Neon Pink-500 for perfect point connection
          p.strokeWeight(1.5 / zoom);
          // Concentric magnetic rings
          p.circle(activeSnapPoint.x, activeSnapPoint.y, 14 / zoom);
          p.stroke('rgba(236, 72, 153, 0.4)');
          p.circle(activeSnapPoint.x, activeSnapPoint.y, 24 / zoom);
          p.fill('#ec4899');
          p.noStroke();
          p.circle(activeSnapPoint.x, activeSnapPoint.y, 5 / zoom);
          p.pop();
        }

        // Render Marquee Selection Box
        if (isMarqueeDragging && marqueeStart) {
          p.push();
          p.stroke('rgba(59, 130, 246, 0.85)'); // Nice Tailwind blue border
          p.strokeWeight(1.5 / zoom);
          (p.drawingContext as CanvasRenderingContext2D).setLineDash([4 / zoom, 4 / zoom]);
          p.fill('rgba(59, 130, 246, 0.08)'); // Semi-transparent blue fill
          
          const x = marqueeStart.x;
          const y = marqueeStart.y;
          const w = wm.x - x;
          const h = wm.y - y;
          p.rect(x, y, w, h, 2);

          p.pop();
        }

        p.pop(); // end pan translate
      };

      const handleAnchorClick = (strokeId: string, index: number) => {
        const isShift = p.keyIsDown(p.SHIFT);
        const alreadySelectedIdx = selectedAnchors.findIndex(sa => sa.strokeId === strokeId && sa.index === index);
        
        if (isShift) {
          if (alreadySelectedIdx !== -1) {
            selectedAnchors.splice(alreadySelectedIdx, 1);
          } else {
            selectedAnchors.push({ strokeId, index });
          }
        } else {
          // If already in selectedAnchors, keep the selection intact so we can drag them together!
          if (alreadySelectedIdx === -1) {
            selectedAnchors = [{ strokeId, index }];
          }
        }
      };

      p.mousePressed = (event?: any) => {
        // Prevent drawing/action if clicking on control panel or other non-canvas UI overlays
        if (event && event.target && event.target.tagName !== 'CANVAS') {
          return;
        }

        const { tool, width, color, opacity } = configRef.current;

        if (spacePanHeld || tool === 'move') {
          isPanning = true;
          panStartMouse = p.createVector(p.mouseX, p.mouseY);
          panStartOffset = { x: panX, y: panY };
          return;
        }

        const wm = getWorldMouse();
        const clickedPos = getPosition(wm.x, wm.y);
        const mx = wm.x;
        const my = wm.y;

        // --- DIRECT EDITING / INTERACTION CHECK (Works in both 'select' and 'bezier' modes!) ---
        if (tool === 'select' || tool === 'bezier') {
          // 1. First priority: Check if we clicked on any anchor or control point of the currently drawing activeStroke (if any)
          if (activeStroke && activeStroke.tool === 'bezier' && activeStroke.anchors) {
            for (let i = 0; i < activeStroke.anchors.length; i++) {
              const anchor = activeStroke.anchors[i];
              const distAnchor = p.dist(mx, my, anchor.p.x, anchor.p.y);
              
              // If it's the first anchor, and there are > 2 anchors, and we are in Bezier mode, clicking it closes the path
              if (i === 0 && activeStroke.anchors.length > 2 && tool === 'bezier') {
                break; // Let it fall through to the close-path logic below
              }

              if (distAnchor < 16 / zoom) {
                handleAnchorClick(activeStroke.id, i);
                draggingItem = { strokeId: activeStroke.id, type: 'anchor', index: i };
                prevMouse = p.createVector(mx, my);
                isDrawing = false; // We are dragging, not adding a new point
                return;
              }
              if (anchor.c1) {
                const distC1 = p.dist(mx, my, anchor.c1.x, anchor.c1.y);
                if (distC1 < 14 / zoom) {
                  draggingItem = { strokeId: activeStroke.id, type: 'control1', index: i };
                  prevMouse = p.createVector(mx, my);
                  isDrawing = false;
                  return;
                }
              }
              if (anchor.c2) {
                const distC2 = p.dist(mx, my, anchor.c2.x, anchor.c2.y);
                if (distC2 < 14 / zoom) {
                  draggingItem = { strokeId: activeStroke.id, type: 'control2', index: i };
                  prevMouse = p.createVector(mx, my);
                  isDrawing = false;
                  return;
                }
              }
            }
          }

          // 2. Second priority: Check if we clicked on any anchor or control point of the currently
          // selectedStroke (single-shape only — skip while multiple shapes are selected as a group)
          if (selectedStrokes.length <= 1 && selectedStroke && !selectedStroke.isLocked && selectedStroke.isVisible !== false && selectedStroke.tool === 'bezier' && selectedStroke.anchors) {
            for (let i = 0; i < selectedStroke.anchors.length; i++) {
              const anchor = selectedStroke.anchors[i];
              const distAnchor = p.dist(mx, my, anchor.p.x, anchor.p.y);
              if (distAnchor < 16 / zoom) {
                handleAnchorClick(selectedStroke.id, i);
                draggingItem = { strokeId: selectedStroke.id, type: 'anchor', index: i };
                prevMouse = p.createVector(mx, my);
                return;
              }
              if (anchor.c1) {
                const distC1 = p.dist(mx, my, anchor.c1.x, anchor.c1.y);
                if (distC1 < 14 / zoom) {
                  draggingItem = { strokeId: selectedStroke.id, type: 'control1', index: i };
                  prevMouse = p.createVector(mx, my);
                  return;
                }
              }
              if (anchor.c2) {
                const distC2 = p.dist(mx, my, anchor.c2.x, anchor.c2.y);
                if (distC2 < 14 / zoom) {
                  draggingItem = { strokeId: selectedStroke.id, type: 'control2', index: i };
                  prevMouse = p.createVector(mx, my);
                  return;
                }
              }
            }
          }

          // 3. Third priority: Check if we clicked on any anchor point of OTHER completed Bezier strokes
          for (const stroke of strokes) {
            if (stroke.tool === 'bezier' && stroke.anchors && stroke !== selectedStroke && !stroke.isLocked && stroke.isVisible !== false) {
              for (let i = 0; i < stroke.anchors.length; i++) {
                const anchor = stroke.anchors[i];
                const distAnchor = p.dist(mx, my, anchor.p.x, anchor.p.y);
                if (distAnchor < 16 / zoom) {
                  setSingleSelection(stroke);
                  handleAnchorClick(stroke.id, i);
                  draggingItem = { strokeId: stroke.id, type: 'anchor', index: i };
                  prevMouse = p.createVector(mx, my);
                  return;
                }
              }
            }
          }
        }

        // Rotate handle: takes priority over re-picking/dragging the selected stroke.
        // Single-shape only, matching the render guard above.
        if (tool === 'select' && selectedStrokes.length === 1 && selectedStroke && !selectedStroke.isLocked && selectedStroke.tool === 'bezier' && selectedStroke.anchors && selectedStroke.anchors.length > 0) {
          const handlePos = getRotateHandlePos(selectedStroke, zoom);
          const bounds = getStrokeBounds(selectedStroke);
          if (handlePos && bounds && p.dist(mx, my, handlePos.x, handlePos.y) < 16 / zoom) {
            const cx = (bounds.minX + bounds.maxX) / 2;
            const cy = (bounds.minY + bounds.maxY) / 2;
            rotatePivot = { x: cx, y: cy };
            rotateStartAngle = Math.atan2(my - cy, mx - cx);
            rotateSnapshot = JSON.parse(JSON.stringify(selectedStroke.anchors));
            draggingItem = { strokeId: selectedStroke.id, type: 'rotate', index: -1 };
            return;
          }
        }

        // Reference image: resize handle first, then its body — checked after strokes so
        // stroke editing always takes priority over the reference sitting behind it.
        // Locked images don't intercept clicks at all, so they can't be nudged by accident.
        if (tool === 'select' && referenceImage && !referenceImage.locked) {
          const handlePos = getReferenceHandlePos(referenceImage);
          if (p.dist(mx, my, handlePos.x, handlePos.y) < REFERENCE_HANDLE_SIZE / zoom) {
            isResizingReference = true;
            return;
          }
          if (mx >= referenceImage.x && mx <= referenceImage.x + referenceImage.width &&
              my >= referenceImage.y && my <= referenceImage.y + referenceImage.height) {
            isDraggingReference = true;
            referenceDragPrevMouse = { x: mx, y: my };
            return;
          }
        }

        // --- Standard Tool Click Handling ---
        if (tool === 'select') {
          const hit = getStrokeUnderMouse(mx, my);
          if (hit) {
            if (p.keyIsDown(p.SHIFT)) {
              // Shift-click adds/removes this shape from the multi-selection
              toggleStrokeSelection(hit);
            } else if (isStrokeSelected(hit.id) && selectedStrokes.length > 1) {
              // Clicking a shape that's already part of a multi-selection keeps the whole
              // group selected, so dragging it moves everything together
              selectedStroke = hit;
              selectedAnchors = [];
            } else {
              setSingleSelection(hit);
              selectedAnchors = [];
            }
            // Also allow dragging the entire selection (single shape or the whole group) smoothly
            draggingItem = { strokeId: hit.id, type: 'stroke', index: -1 };
            prevMouse = p.createVector(mx, my);
          } else {
            // Clicked empty space
            if (!p.keyIsDown(p.SHIFT)) {
              setSingleSelection(null);
              selectedAnchors = [];
            }
            draggingItem = null;
            marqueeStart = p.createVector(mx, my);
            isMarqueeDragging = true;
          }
        } else if (tool === 'bezier') {
          isDrawing = true;
          // Create or append to bezier path
          if (!activeStroke) {
            activeStroke = {
              id: Math.random().toString(36).substring(2, 9),
              tool: 'bezier',
              points: [],
              anchors: [],
              width,
              color,
              opacity,
              cap: configRef.current.cap
            };
          }

          const newAnchor: BezierAnchor = {
            p: { x: clickedPos.x, y: clickedPos.y },
            c1: { x: clickedPos.x, y: clickedPos.y },
            c2: { x: clickedPos.x, y: clickedPos.y }
          };

          // Check if clicking near the very first anchor point to CLOSE the path
          if (activeStroke.anchors && activeStroke.anchors.length > 2) {
            const firstA = activeStroke.anchors[0];
            const distToStart = p.dist(clickedPos.x, clickedPos.y, firstA.p.x, firstA.p.y);
            if (distToStart < 16 / zoom) {
              // Close and complete
              activeStroke.isClosed = true;
              
              // Recalculate control points of the closed loop to make the start/end connection perfectly smooth
              const currentTension = 0.35;
              const smoothed = computeControlPoints(activeStroke.anchors!.map(a => a.p), true, currentTension, activeStroke.anchors);
              activeStroke.anchors = smoothed;

              strokes.push(activeStroke);
              setSingleSelection(activeStroke);
              activeStroke = null;
              isDrawing = false;
              saveState();
              return;
            }
          }

          pendingAnchorRedo = [];
          activeStroke.anchors!.push(newAnchor);

          // Re-smooth all anchors added so far to keep the curve perfectly smooth with zero sharp corners
          const currentTension = 0.35;
          const smoothed = computeControlPoints(activeStroke.anchors!.map(a => a.p), false, currentTension, activeStroke.anchors);
          activeStroke.anchors = smoothed;

          draggingItem = { strokeId: activeStroke.id, type: 'control2', index: activeStroke.anchors!.length - 1 };
          prevMouse = clickedPos;

        } else if (tool === 'brush') {
          isDrawing = true;
          prevMouse = clickedPos;
          smoothedMouse = clickedPos.copy();

          const newStroke: VectorStroke = {
            id: Math.random().toString(36).substring(2, 9),
            tool: 'brush',
            points: [{ x: clickedPos.x, y: clickedPos.y }],
            width,
            color,
            opacity,
            cap: configRef.current.cap
          };
          activeStroke = newStroke;
        }
      };

      p.mouseDragged = () => {
        if (isPanning && panStartMouse && panStartOffset) {
          panX = panStartOffset.x + (p.mouseX - panStartMouse.x);
          panY = panStartOffset.y + (p.mouseY - panStartMouse.y);
          return;
        }

        if (referenceImage && (isDraggingReference || isResizingReference)) {
          const wm = getWorldMouse();
          if (isResizingReference) {
            const aspect = referenceImage.img.width / referenceImage.img.height;
            const newWidth = Math.max(20, wm.x - referenceImage.x);
            referenceImage.width = newWidth;
            referenceImage.height = newWidth / aspect;
          } else if (isDraggingReference && referenceDragPrevMouse) {
            const dx = wm.x - referenceDragPrevMouse.x;
            const dy = wm.y - referenceDragPrevMouse.y;
            referenceImage.x += dx;
            referenceImage.y += dy;
            referenceDragPrevMouse = { x: wm.x, y: wm.y };
          }
          return;
        }

        if (isMarqueeDragging) {
          return;
        }
        const { tool, smoothing } = configRef.current;
        const wm = getWorldMouse();
        const targetPos = getPosition(wm.x, wm.y);
        const currentMouse = p.createVector(wm.x, wm.y);

        if (draggingItem) {
          const sIndex = strokes.findIndex(s => s.id === draggingItem!.strokeId);
          const targetStroke = sIndex !== -1 ? strokes[sIndex] : activeStroke;
          
          if (targetStroke) {
            if (draggingItem.type === 'stroke') {
              if (prevMouse) {
                const dx = currentMouse.x - prevMouse.x;
                const dy = currentMouse.y - prevMouse.y;

                // If the dragged shape is part of a multi-selection, move the whole group
                // together; otherwise just the one shape.
                const strokesToMove = isStrokeSelected(targetStroke.id) && selectedStrokes.length > 1
                  ? selectedStrokes
                  : [targetStroke];

                for (const s of strokesToMove) {
                  if (s.anchors) {
                    for (const anchor of s.anchors) {
                      anchor.p.x += dx;
                      anchor.p.y += dy;
                      if (anchor.c1) { anchor.c1.x += dx; anchor.c1.y += dy; }
                      if (anchor.c2) { anchor.c2.x += dx; anchor.c2.y += dy; }
                    }
                  }
                  if (s.points) {
                    for (const pt of s.points) {
                      pt.x += dx;
                      pt.y += dy;
                    }
                  }
                }
                prevMouse = currentMouse;
              }
              return;
            } else if (draggingItem.type === 'rotate' && rotatePivot && targetStroke.anchors) {
              let angle = Math.atan2(wm.y - rotatePivot.y, wm.x - rotatePivot.x) - rotateStartAngle;
              if (p.keyIsDown(p.SHIFT)) {
                const step = Math.PI / 12; // 15°
                angle = Math.round(angle / step) * step;
              }
              const cos = Math.cos(angle);
              const sin = Math.sin(angle);
              const rotatePoint = (pt: StrokePoint) => {
                const dx = pt.x - rotatePivot!.x;
                const dy = pt.y - rotatePivot!.y;
                return {
                  x: rotatePivot!.x + dx * cos - dy * sin,
                  y: rotatePivot!.y + dx * sin + dy * cos
                };
              };
              for (let i = 0; i < targetStroke.anchors.length; i++) {
                const src = rotateSnapshot[i];
                const dst = targetStroke.anchors[i];
                dst.p = rotatePoint(src.p);
                if (src.c1) dst.c1 = rotatePoint(src.c1);
                if (src.c2) dst.c2 = rotatePoint(src.c2);
              }
              return;
            } else if (targetStroke.anchors) {
              const anchor = targetStroke.anchors[draggingItem.index];
              if (draggingItem.type === 'anchor') {
                const isSelected = selectedAnchors.some(sa => sa.strokeId === targetStroke.id && sa.index === draggingItem!.index);
                if (isSelected && selectedAnchors.length > 1) {
                  const dx = targetPos.x - anchor.p.x;
                  const dy = targetPos.y - anchor.p.y;
                  if (dx !== 0 || dy !== 0) {
                    for (const sa of selectedAnchors) {
                      const saStroke = sa.strokeId === targetStroke.id ? targetStroke : strokes.find(s => s.id === sa.strokeId);
                      if (saStroke && saStroke.anchors && sa.index >= 0 && sa.index < saStroke.anchors.length) {
                        const saAnchor = saStroke.anchors[sa.index];
                        saAnchor.p.x += dx;
                        saAnchor.p.y += dy;
                        if (saAnchor.c1) { saAnchor.c1.x += dx; saAnchor.c1.y += dy; }
                        if (saAnchor.c2) { saAnchor.c2.x += dx; saAnchor.c2.y += dy; }
                      }
                    }
                  }
                } else {
                  // Dragging a single anchor point automatically updates all control points for perfect smoothness
                  anchor.p.x = targetPos.x;
                  anchor.p.y = targetPos.y;
                  
                  const currentTension = 0.35;
                  const smoothed = computeControlPoints(targetStroke.anchors.map(a => a.p), targetStroke.isClosed, currentTension, targetStroke.anchors);
                  for (let j = 0; j < targetStroke.anchors.length; j++) {
                    // Only update the ones that aren't manually adjusted, or if we want anchor dragging to keep the local flow smooth
                    targetStroke.anchors[j].c1 = { x: smoothed[j].c1.x, y: smoothed[j].c1.y };
                    targetStroke.anchors[j].c2 = { x: smoothed[j].c2.x, y: smoothed[j].c2.y };
                  }
                }
              } else if (draggingItem.type === 'control2') {
                anchor.isManuallyAdjusted = true;
                const prevA = draggingItem.index > 0 ? targetStroke.anchors[draggingItem.index - 1] : null;
                const nextA = draggingItem.index < targetStroke.anchors.length - 1 ? targetStroke.anchors[draggingItem.index + 1] : null;
                
                let vx = targetPos.x - anchor.p.x;
                let vy = targetPos.y - anchor.p.y;
                let len = Math.hypot(vx, vy);
                if (len > 0) {
                  vx /= len;
                  vy /= len;
                }

                // Constrain handle length to at most 0.6 of distance to next anchor to allow full curves
                const maxLen = nextA ? Math.hypot(nextA.p.x - anchor.p.x, nextA.p.y - anchor.p.y) * 0.6 : 150;
                const constrainedLen = Math.min(len, maxLen);

                anchor.c2 = {
                  x: anchor.p.x + vx * constrainedLen,
                  y: anchor.p.y + vy * constrainedLen
                };

                // Symmetrical control point adjustment for c1
                if (anchor.c1) {
                  const prevLen = prevA ? Math.hypot(prevA.p.x - anchor.p.x, prevA.p.y - anchor.p.y) * 0.6 : 150;
                  const c1Len = Math.min(constrainedLen, prevLen);
                  anchor.c1.x = anchor.p.x - vx * c1Len;
                  anchor.c1.y = anchor.p.y - vy * c1Len;
                }
              } else if (draggingItem.type === 'control1') {
                anchor.isManuallyAdjusted = true;
                const prevA = draggingItem.index > 0 ? targetStroke.anchors[draggingItem.index - 1] : null;
                const nextA = draggingItem.index < targetStroke.anchors.length - 1 ? targetStroke.anchors[draggingItem.index + 1] : null;

                let vx = targetPos.x - anchor.p.x;
                let vy = targetPos.y - anchor.p.y;
                let len = Math.hypot(vx, vy);
                if (len > 0) {
                  vx /= len;
                  vy /= len;
                }

                // Constrain handle length to at most 0.6 of distance to previous anchor to allow full curves
                const maxLen = prevA ? Math.hypot(prevA.p.x - anchor.p.x, prevA.p.y - anchor.p.y) * 0.6 : 150;
                const constrainedLen = Math.min(len, maxLen);

                anchor.c1 = {
                  x: anchor.p.x + vx * constrainedLen,
                  y: anchor.p.y + vy * constrainedLen
                };

                // Symmetrical control point adjustment for c2
                if (anchor.c2) {
                  const nextLen = nextA ? Math.hypot(nextA.p.x - anchor.p.x, nextA.p.y - anchor.p.y) * 0.6 : 150;
                  const c2Len = Math.min(constrainedLen, nextLen);
                  anchor.c2.x = anchor.p.x - vx * c2Len;
                  anchor.c2.y = anchor.p.y - vy * c2Len;
                }
              }
            }
          }
          return;
        }

        if (!isDrawing || !activeStroke || !prevMouse) return;

        if (tool === 'brush') {
          const dist = targetPos.dist(prevMouse);
          if (dist < 1) return;
          
          // Follow the cursor instantly during drawing to prevent lag and ensure precise loops/circles
          smoothedMouse!.x = targetPos.x;
          smoothedMouse!.y = targetPos.y;

          activeStroke.points.push({ x: smoothedMouse!.x, y: smoothedMouse!.y });
          prevMouse = targetPos;
        }
      };

      p.mouseReleased = () => {
        isDrawing = false;

        if (isPanning) {
          isPanning = false;
          panStartMouse = null;
          panStartOffset = null;
          return;
        }

        if (isDraggingReference || isResizingReference) {
          isDraggingReference = false;
          isResizingReference = false;
          referenceDragPrevMouse = null;
          return;
        }

        // Handle Marquee Selection Completion
        if (isMarqueeDragging && marqueeStart) {
          isMarqueeDragging = false;

          const wm = getWorldMouse();
          const endX = wm.x;
          const endY = wm.y;
          
          const x1 = Math.min(marqueeStart.x, endX);
          const x2 = Math.max(marqueeStart.x, endX);
          const y1 = Math.min(marqueeStart.y, endY);
          const y2 = Math.max(marqueeStart.y, endY);
          
          const widthSel = x2 - x1;
          const heightSel = y2 - y1;
          
          // Only perform selection if the marquee box is larger than a tiny threshold (e.g., 4px) to avoid accidental clicks clearing state
          if (widthSel > 4 && heightSel > 4) {
            const newlySelected: SelectedAnchor[] = [];

            // If we already have a single stroke selected, prioritize refining anchor
            // selection within it (precise per-anchor editing of one shape)
            if (selectedStrokes.length === 1 && selectedStroke && selectedStroke.tool === 'bezier' && selectedStroke.anchors) {
              for (let i = 0; i < selectedStroke.anchors.length; i++) {
                const anchor = selectedStroke.anchors[i];
                if (anchor.p.x >= x1 && anchor.p.x <= x2 && anchor.p.y >= y1 && anchor.p.y <= y2) {
                  newlySelected.push({ strokeId: selectedStroke.id, index: i });
                }
              }
            } else {
              // Otherwise, a marquee over empty space selects the whole shapes it touches
              // (not just their anchors), so they can be moved/copied/deleted as a group.
              for (const stroke of strokes) {
                if (stroke.tool === 'bezier' && stroke.anchors) {
                  for (let i = 0; i < stroke.anchors.length; i++) {
                    const anchor = stroke.anchors[i];
                    if (anchor.p.x >= x1 && anchor.p.x <= x2 && anchor.p.y >= y1 && anchor.p.y <= y2) {
                      newlySelected.push({ strokeId: stroke.id, index: i });
                    }
                  }
                }
              }
              const touchedIds = Array.from(new Set(newlySelected.map(ns => ns.strokeId)));
              const touchedStrokes = touchedIds
                .map(id => strokes.find(s => s.id === id))
                .filter((s): s is VectorStroke => !!s);
              if (touchedStrokes.length > 0) {
                if (p.keyIsDown(p.SHIFT)) {
                  for (const s of touchedStrokes) {
                    if (!isStrokeSelected(s.id)) selectedStrokes.push(s);
                  }
                  selectedStroke = touchedStrokes[touchedStrokes.length - 1];
                } else {
                  selectedStrokes = touchedStrokes;
                  selectedStroke = touchedStrokes[0];
                }
              }
            }
            
            // Apply Shift-add logic if shift is pressed, otherwise replace
            if (p.keyIsDown(p.SHIFT)) {
              for (const ns of newlySelected) {
                const exists = selectedAnchors.some(sa => sa.strokeId === ns.strokeId && sa.index === ns.index);
                if (!exists) {
                  selectedAnchors.push(ns);
                }
              }
            } else {
              selectedAnchors = newlySelected;
            }
          }
          
          marqueeStart = null;
          return;
        }

        if (draggingItem) {
          // If this is just the control handle of the point we placed a moment ago on the
          // still-in-progress bezier path, there's nothing committed yet to save — the path
          // isn't in `strokes` until it's finished. Only save when a real (already-committed)
          // stroke's anchor/handle was actually dragged.
          const wasActivePathPoint = !!activeStroke && draggingItem.strokeId === activeStroke.id;
          const draggedStrokeId = draggingItem.strokeId;
          const wasGroupMove = draggingItem.type === 'stroke' && isStrokeSelected(draggedStrokeId) && selectedStrokes.length > 1;
          draggingItem = null;
          if (!wasActivePathPoint) {
            // A manual drag deliberately reshaped this stroke (or the whole group, if moved
            // together) — drop cached Simplify/Smooth originals so a later slider touch starts
            // from this edit, not stale prior geometry.
            if (wasGroupMove) {
              for (const s of selectedStrokes) originalAnchors.delete(s.id);
            } else {
              originalAnchors.delete(draggedStrokeId);
            }
            saveState(); // save after anchor dragging finishes
          }
          return;
        }

        if (activeStroke) {
          if (activeStroke.tool === 'brush') {
            if (activeStroke.points && activeStroke.points.length > 2) {
              // 1. Smooth the raw hand drawing using a light moving average (5-point window)
              // to filter out high-frequency hand-shaking tremors without blunting detail.
              const smoothedPoints = movingAverageSmooth(activeStroke.points, 5);
              
              // 2. Detect closed loop based on the smoothed points
              let isClosed = false;
              if (smoothedPoints.length > 5) {
                const startPt = smoothedPoints[0];
                const endPt = smoothedPoints[smoothedPoints.length - 1];
                const d = Math.hypot(startPt.x - endPt.x, startPt.y - endPt.y);
                const closeThreshold = 20; // Natural, balanced threshold for closing loops
                if (d < closeThreshold) {
                  isClosed = true;
                  const midX = (startPt.x + endPt.x) / 2;
                  const midY = (startPt.y + endPt.y) / 2;
                  smoothedPoints[0] = { x: midX, y: midY };
                  smoothedPoints[smoothedPoints.length - 1] = { x: midX, y: midY };
                }
              }
              
              // 3. Simplify points with a moderate tolerance (1.4px).
              // This is the magic number: if you draw a straight-ish line, all intermediate wiggles
              // within 1.4px are pruned, resulting in a PERFECT, clean straight line.
              // At the same time, curves and circles retain their accurate organic geometry.
              const simplified = simplifyPoints(smoothedPoints, 1.4);

              // Simplification leaves point spacing very uneven — dense where the hand
              // curved, sparse where it went straight. Fitting bezier tangents on that
              // directly is what causes the slightly bumpy/uneven look; resampling to
              // even arc-length spacing first gives the curve fit a consistent basis.
              let resampled = resamplePoints(simplified, 8);

              // If closed, ensure first and last elements match perfectly and remove duplicate end point
              if (isClosed && resampled.length > 3) {
                resampled[resampled.length - 1] = { x: resampled[0].x, y: resampled[0].y };
                resampled.pop(); // Pop the duplicate end point so computeControlPoints treats it as a true closed loop
              }
              
              // 4. Compute perfectly smooth and continuous Bezier control points with dynamic tension
              const currentTension = 0.35;
              const anchors = computeControlPoints(resampled, isClosed, currentTension);
              
              activeStroke.tool = 'bezier';
              activeStroke.isClosed = isClosed;
              activeStroke.anchors = anchors;
              activeStroke.points = []; // clear raw coordinate array to save memory

              strokes.push(activeStroke);
              setSingleSelection(activeStroke);
              saveState();
            }
            // Else: a stray click or barely-moved dab with too few points to be a real
            // stroke — discard it instead of committing a stray dot to the canvas.
            activeStroke = null;
          }
        }
        prevMouse = null;
        smoothedMouse = null;
      };

      p.keyPressed = () => {
        if (p.keyCode === p.ENTER || p.keyCode === p.ESCAPE) {
          (p as any).finishActivePath();
        }
        if (p.keyCode === p.DELETE || p.keyCode === p.BACKSPACE) {
          (p as any).deleteSelected();
        }
        // Keyboard zoom: +/- step in/out around the viewport center, 0 resets
        if (p.key === '+' || p.key === '=') {
          applyZoom(1.2, p.width / 2, p.height / 2);
        } else if (p.key === '-' || p.key === '_') {
          applyZoom(1 / 1.2, p.width / 2, p.height / 2);
        } else if (p.key === '0') {
          zoom = 1;
          panX = 0;
          panY = 0;
        }
        if (p.keyCode === 32 && !spacePanHeld) {
          spacePanHeld = true;
          setIsSpaceHeld(true);
          return false; // stop the browser from scrolling the page on Space
        }
      };

      p.keyReleased = () => {
        if (p.keyCode === 32) {
          spacePanHeld = false;
          setIsSpaceHeld(false);
          if (isPanning) {
            isPanning = false;
            panStartMouse = null;
            panStartOffset = null;
          }
        }
      };

      // Scroll to zoom, centered on the cursor so the point under it stays fixed
      p.mouseWheel = (event: any) => {
        const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
        applyZoom(factor, p.mouseX, p.mouseY);
        return false;
      };

      // Exposed command methods called via triggers
      (p as any).finishActivePath = () => {
        if (activeStroke && activeStroke.tool === 'bezier') {
          const hadEnoughAnchors = activeStroke.anchors && activeStroke.anchors.length > 1;
          if (hadEnoughAnchors) {
            // Apply a final smoothing pass to ensure open paths have perfect curvature, preserving any manually adjusted points
            const currentTension = 0.35;
            const smoothed = computeControlPoints(activeStroke.anchors!.map(a => a.p), activeStroke.isClosed, currentTension, activeStroke.anchors);
            activeStroke.anchors = smoothed;
            strokes.push(activeStroke);
            setSingleSelection(activeStroke);
          }
          activeStroke = null;
          pendingAnchorRedo = [];
          if (hadEnoughAnchors) {
            saveState();
          }
        }
      };

      (p as any).deleteSelected = () => {
        if (selectedStrokes.length > 1) {
          const idsToDelete = new Set(selectedStrokes.map(s => s.id));
          for (const id of idsToDelete) originalAnchors.delete(id);
          strokes = strokes.filter(s => !idsToDelete.has(s.id));
          setSingleSelection(null);
          selectedAnchors = [];
          saveState();
          return;
        }

        if (selectedStroke) {
          if (selectedStroke.tool === 'bezier' && selectedStroke.anchors && selectedAnchors.length > 0) {
            const targetStroke = selectedStroke;
            // Get indices of selected anchors for this stroke
            const indicesToDelete = selectedAnchors
              .filter(sa => sa.strokeId === targetStroke.id)
              .map(sa => sa.index);
              
            if (indicesToDelete.length > 0) {
              // Sort indices in descending order to delete from end and avoid index shift
              indicesToDelete.sort((a, b) => b - a);
              
              const remainingAnchors = [...targetStroke.anchors];
              for (const idx of indicesToDelete) {
                if (idx >= 0 && idx < remainingAnchors.length) {
                  remainingAnchors.splice(idx, 1);
                }
              }
              
              if (remainingAnchors.length <= 1) {
                // If 1 or 0 anchors left, delete the entire stroke
                strokes = strokes.filter(s => s.id !== targetStroke.id);
                setSingleSelection(null);
                selectedAnchors = [];
              } else {
                // Update anchors
                targetStroke.anchors = remainingAnchors;
                selectedAnchors = []; // clear selection

                // Re-smooth control points for the remaining anchors so they connect beautifully
                const currentTension = 0.35;
                const smoothed = computeControlPoints(
                  targetStroke.anchors.map(a => a.p),
                  targetStroke.isClosed,
                  currentTension,
                  targetStroke.anchors
                );
                targetStroke.anchors = smoothed;
              }
              // Deleting anchors deliberately reshapes the stroke — drop its cached
              // Simplify/Smooth original so it doesn't get silently resurrected later.
              originalAnchors.delete(targetStroke.id);
              saveState();
              return;
            }
          }

          // Fallback: delete the entire stroke if no specific anchors are highlighted
          originalAnchors.delete(selectedStroke.id);
          strokes = strokes.filter(s => s.id !== selectedStroke!.id);
          setSingleSelection(null);
          selectedAnchors = [];
          saveState();
        }
      };

      (p as any).copySelected = () => {
        if (selectedStrokes.length > 0) {
          clipboard = JSON.parse(JSON.stringify(selectedStrokes));
          pasteOffsetCount = 0;
        }
      };

      (p as any).pasteClipboard = () => {
        if (clipboard.length === 0) return;

        // Each successive paste (without a fresh copy) steps further away from the last,
        // so repeated Cmd+V cascades duplicates instead of stacking them all identically.
        pasteOffsetCount++;
        const offset = 24 * pasteOffsetCount;

        const pastedStrokes: VectorStroke[] = JSON.parse(JSON.stringify(clipboard));
        for (const pasted of pastedStrokes) {
          pasted.id = Math.random().toString(36).substring(2, 9);

          if (pasted.anchors) {
            for (const a of pasted.anchors) {
              a.p.x += offset;
              a.p.y += offset;
              if (a.c1) { a.c1.x += offset; a.c1.y += offset; }
              if (a.c2) { a.c2.x += offset; a.c2.y += offset; }
            }
          }
          if (pasted.points) {
            for (const pt of pasted.points) {
              pt.x += offset;
              pt.y += offset;
            }
          }

          strokes.push(pasted);
        }

        selectedStrokes = pastedStrokes;
        selectedStroke = pastedStrokes[pastedStrokes.length - 1];
        selectedAnchors = [];
        saveState();
      };

      // Merge strokes read back out of a previously-exported SVG (see svgExporter's embedded
      // metadata) into whatever's already on the canvas — at their original coordinates, with
      // fresh ids so they can't collide with anything currently on the canvas.
      (p as any).importStrokes = (imported: VectorStroke[]) => {
        if (!imported || imported.length === 0) return;

        const newStrokes: VectorStroke[] = JSON.parse(JSON.stringify(imported)).map((s: VectorStroke) => ({
          ...s,
          id: Math.random().toString(36).substring(2, 9)
        }));

        strokes.push(...newStrokes);
        selectedStrokes = newStrokes;
        selectedStroke = newStrokes[newStrokes.length - 1];
        selectedAnchors = [];
        saveState();
      };

      // Arc-length-aware smoothing: each point moves toward a Gaussian-weighted average of
      // nearby points measured by distance WALKED ALONG THE PATH (not straight-line distance
      // through space), with the weight falling off smoothly beyond `radius` world pixels.
      // `radius` is a real physical distance, so the same slider value means the same
      // smoothing reach on any shape — unlike the old fixed-ratio index-neighbor blend, where
      // the exact same "amount" flattened densely-clicked (narrow/complex) paths far faster
      // than sparse (big) ones, since index-adjacent points on a dense path sit much closer
      // together. Walking along the path (rather than straight-line distance) also matters
      // for crossing/looping strokes — two strands that happen to pass close to each other in
      // space but are unrelated parts of the path must never get blended together.
      // Endpoints of an open path stay fixed, same as before.
      const smoothPass = (points: StrokePoint[], isClosed: boolean, radius: number): StrokePoint[] => {
        const n = points.length;
        if (n <= 2 || radius <= 0) return points;

        // segLen[i] = distance from points[i] to the next point along the path
        const segLen: number[] = new Array(n).fill(0);
        for (let i = 0; i < (isClosed ? n : n - 1); i++) {
          const j = isClosed ? (i + 1) % n : i + 1;
          segLen[i] = Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
        }

        const sigma = radius / 2;
        const twoSigmaSq = 2 * sigma * sigma;
        const maxReach = radius * 2.5; // beyond this the gaussian weight is negligible
        const result = points.map(pt => ({ ...pt }));

        const startI = isClosed ? 0 : 1;
        const endI = isClosed ? n : n - 1;

        for (let i = startI; i < endI; i++) {
          let sumX = points[i].x; // self, at distance 0 → weight 1
          let sumY = points[i].y;
          let sumW = 1;

          let dist = 0;
          let j = i;
          while (true) {
            const nextJ = isClosed ? (j + 1) % n : j + 1;
            if (isClosed ? nextJ === i : nextJ >= n) break;
            dist += segLen[j];
            if (dist > maxReach) break;
            const w = Math.exp(-(dist * dist) / twoSigmaSq);
            sumX += points[nextJ].x * w;
            sumY += points[nextJ].y * w;
            sumW += w;
            j = nextJ;
          }

          dist = 0;
          j = i;
          while (true) {
            const prevJ = isClosed ? (j - 1 + n) % n : j - 1;
            if (isClosed ? prevJ === i : prevJ < 0) break;
            dist += segLen[prevJ];
            if (dist > maxReach) break;
            const w = Math.exp(-(dist * dist) / twoSigmaSq);
            sumX += points[prevJ].x * w;
            sumY += points[prevJ].y * w;
            sumW += w;
            j = prevJ;
          }

          result[i] = { x: sumX / sumW, y: sumY / sumW };
        }
        return result;
      };

      // Live preview: always recomputes from the stroke's untouched original points —
      // simplify first (fewer anchors), then `smoothAmount` smoothing passes — so dragging
      // either slider is fully reversible and neither can compound on itself or clobber
      // the other's result. Anchor count can change (simplify), so a stale per-anchor
      // selection on this stroke is cleared rather than pointing at the wrong anchors.
      (p as any).previewShape = (simplifyTolerance: number, smoothAmount: number) => {
        if (!selectedStroke || selectedStroke.tool !== 'bezier' || !selectedStroke.anchors || selectedStroke.anchors.length <= 1) {
          return;
        }

        const previousCount = selectedStroke.anchors.length;
        const basePoints = getOriginalPoints(selectedStroke);
        const isClosed = !!selectedStroke.isClosed;

        for (const a of selectedStroke.anchors) {
          delete a.isManuallyAdjusted;
        }

        let points = simplifyTolerance > 0 && basePoints.length > 2
          ? simplifyPoints(basePoints, simplifyTolerance)
          : basePoints.map(pt => ({ ...pt }));

        points = smoothPass(points, isClosed, smoothAmount);

        const currentTension = 0.35;
        selectedStroke.anchors = computeControlPoints(points, isClosed, currentTension);

        if (selectedStroke.anchors.length !== previousCount) {
          selectedAnchors = selectedAnchors.filter(sa => sa.strokeId !== selectedStroke!.id);
        }

        // Remember this stroke's own amounts, so selecting a different stroke and coming
        // back later restores them instead of leaving the sliders at the last-used values.
        selectedStroke.simplifyAmount = simplifyTolerance;
        selectedStroke.smoothAmount = smoothAmount;
      };

      // Commit the currently previewed Simplify/Smooth amounts as a single undo step
      (p as any).commitShape = () => {
        if (selectedStroke && originalAnchors.has(selectedStroke.id)) {
          saveState();
        }
      };

      (p as any).toggleClosedSelected = () => {
        if (selectedStroke && selectedStroke.tool === 'bezier') {
          if (selectedStroke.anchors && selectedStroke.anchors.length > 1) {
            selectedStroke.isClosed = !selectedStroke.isClosed;
            
            // Recalculate control handles to match new loop configuration
            const currentTension = 0.35;
            // Retain custom adjustments where possible, but recompute tangent direction
            const smoothed = computeControlPoints(
              selectedStroke.anchors.map(a => a.p), 
              selectedStroke.isClosed, 
              currentTension,
              selectedStroke.anchors
            );
            selectedStroke.anchors = smoothed;
            saveState();
          }
        }
      };

      (p as any).clearCanvas = () => {
        strokes = [];
        activeStroke = null;
        setSingleSelection(null);
        originalAnchors.clear();
        saveState();
      };

      // Reference/trace image — not part of undo/redo history (see the state comment above)
      (p as any).setReferenceImageFromDataUrl = (dataUrl: string) => {
        p.loadImage(dataUrl, (img: p5.Image) => {
          // Default to a reasonable size centered in the current viewport, regardless of zoom
          const maxDim = 320 / zoom;
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = img.width * scale;
          const h = img.height * scale;
          const viewCenterX = (p.width / 2 - panX) / zoom;
          const viewCenterY = (p.height / 2 - panY) / zoom;
          referenceImage = {
            img,
            x: viewCenterX - w / 2,
            y: viewCenterY - h / 2,
            width: w,
            height: h,
            opacity: 0.5,
            locked: false
          };
        });
      };

      (p as any).setReferenceOpacity = (opacity: number) => {
        if (referenceImage) {
          referenceImage.opacity = opacity;
        }
      };

      (p as any).setReferenceLocked = (locked: boolean) => {
        if (referenceImage) {
          referenceImage.locked = locked;
        }
      };

      (p as any).removeReferenceImage = () => {
        referenceImage = null;
      };

      (p as any).undo = () => {
        // A bezier path being placed isn't one action per click — it's not even in `strokes`
        // yet. Step back one anchor at a time instead of discarding the whole in-progress path.
        if (activeStroke && activeStroke.tool === 'bezier' && activeStroke.anchors && activeStroke.anchors.length > 0) {
          const removed = activeStroke.anchors.pop()!;
          pendingAnchorRedo.push(removed);
          if (activeStroke.anchors.length === 0) {
            activeStroke = null;
          } else {
            const currentTension = 0.35;
            activeStroke.anchors = computeControlPoints(activeStroke.anchors.map(a => a.p), false, currentTension, activeStroke.anchors);
          }
          return;
        }

        if (historyIndex > 0) {
          historyIndex--;
          strokes = JSON.parse(JSON.stringify(history[historyIndex]));
          setSingleSelection(null);
          activeStroke = null;
          // History can jump anywhere; any cached Simplify/Smooth original may no longer
          // match what's now on the canvas, so drop it all and let it re-capture fresh.
          originalAnchors.clear();
          persistStrokes();
        }
      };

      (p as any).redo = () => {
        // Restore anchors undone from an in-progress path before falling back to
        // the committed-stroke history.
        if (pendingAnchorRedo.length > 0) {
          const anchor = pendingAnchorRedo.pop()!;
          if (!activeStroke) {
            const { width, color, opacity } = configRef.current;
            activeStroke = {
              id: Math.random().toString(36).substring(2, 9),
              tool: 'bezier',
              points: [],
              anchors: [],
              width,
              color,
              opacity,
              cap: configRef.current.cap
            };
          }
          activeStroke.anchors!.push(anchor);
          const currentTension = 0.35;
          activeStroke.anchors = computeControlPoints(activeStroke.anchors!.map(a => a.p), false, currentTension, activeStroke.anchors);
          return;
        }

        if (historyIndex < history.length - 1) {
          historyIndex++;
          strokes = JSON.parse(JSON.stringify(history[historyIndex]));
          setSingleSelection(null);
          activeStroke = null;
          originalAnchors.clear();
          persistStrokes();
        }
      };

      (p as any).downloadCanvas = () => {
        const exportG = p.createGraphics(p.width, p.height);
        if (configRef.current.bgColor === 'transparent') {
          exportG.clear();
        } else {
          exportG.background(configRef.current.bgColor || '#FFFBF1'); // match background
        }
        
        // Render perfect vectors onto exporting graphic
        for (const stroke of strokes) {
          if (stroke.isVisible === false) continue;
          exportG.push();
          exportG.noFill();
          exportG.strokeWeight(stroke.width);
          exportG.strokeCap(stroke.cap === 'square' ? p.SQUARE : p.ROUND);
          exportG.strokeJoin(stroke.cap === 'square' ? p.MITER : p.ROUND);
          
          const c = exportG.color(stroke.color);
          c.setAlpha(stroke.opacity * 255);
          exportG.stroke(c);

          if (stroke.tool === 'bezier' && stroke.anchors) {
            exportG.beginShape();
            exportG.vertex(stroke.anchors[0].p.x, stroke.anchors[0].p.y);
            for (let i = 0; i < stroke.anchors.length - 1; i++) {
              const a1 = stroke.anchors[i];
              const a2 = stroke.anchors[i+1];
              exportG.bezierVertex(
                a1.c2 ? a1.c2.x : a1.p.x, a1.c2 ? a1.c2.y : a1.p.y,
                a2.c1 ? a2.c1.x : a2.p.x, a2.c1 ? a2.c1.y : a2.p.y,
                a2.p.x, a2.p.y
              );
            }
            if (stroke.isClosed && stroke.anchors.length > 2) {
              const aLast = stroke.anchors[stroke.anchors.length - 1];
              const aFirst = stroke.anchors[0];
              exportG.bezierVertex(
                aLast.c2 ? aLast.c2.x : aLast.p.x, aLast.c2 ? aLast.c2.y : aLast.p.y,
                aFirst.c1 ? aFirst.c1.x : aFirst.p.x, aFirst.c1 ? aFirst.c1.y : aFirst.p.y,
                aFirst.p.x, aFirst.p.y
              );
              exportG.endShape(p.CLOSE);
            } else {
              exportG.endShape();
            }
          } else {
            exportG.beginShape();
            if (stroke.points.length > 0) {
              exportG.curveVertex(stroke.points[0].x, stroke.points[0].y);
              for (const pt of stroke.points) {
                exportG.curveVertex(pt.x, pt.y);
              }
              exportG.curveVertex(stroke.points[stroke.points.length - 1].x, stroke.points[stroke.points.length - 1].y);
            }
            exportG.endShape();
          }
          exportG.pop();
        }

        exportG.save('calligraphy-vector-masterpiece.png');
        exportG.remove();
      };

      (p as any).downloadSvg = () => {
        const svgStr = generateSvgString(strokes, p.width, p.height, configRef.current.bgColor);
        const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'calligraphy-vector-masterpiece.svg';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      };

      (p as any).copySvgToClipboard = (onSuccess: (msg: string) => void, onFailure: (msg: string) => void) => {
        try {
          const svgStr = generateSvgString(strokes, p.width, p.height, configRef.current.bgColor);
          navigator.clipboard.writeText(svgStr).then(() => {
            onSuccess('SVG copied to clipboard successfully!');
          }).catch(err => {
            onFailure('Could not copy SVG: ' + err.message);
          });
        } catch (e: any) {
          onFailure(e.message || 'Export error');
        }
      };

      (p as any).updateStrokeParams = (width: number, color: string, cap: 'round' | 'square') => {
        let changed = false;
        if (selectedStroke) {
          if (selectedStroke.width !== width || selectedStroke.color !== color || selectedStroke.cap !== cap) {
            selectedStroke.width = width;
            selectedStroke.color = color;
            selectedStroke.cap = cap;
            changed = true;
          }
        }
        if (activeStroke) {
          if (activeStroke.width !== width || activeStroke.color !== color || activeStroke.cap !== cap) {
            activeStroke.width = width;
            activeStroke.color = color;
            activeStroke.cap = cap;
            changed = true;
          }
        }
        if (changed) {
          saveState();
        }
      };

    };

    const myP5 = new p5(sketch, containerRef.current);
    p5Instance.current = myP5;

    return () => {
      myP5.remove();
    };
  }, []);

  // Sync trigger hooks
  useEffect(() => {
    if (clearTrigger && p5Instance.current) {
      (p5Instance.current as any).clearCanvas();
      setClearTrigger(false);
    }
  }, [clearTrigger, setClearTrigger]);

  useEffect(() => {
    if (downloadTrigger && p5Instance.current) {
      (p5Instance.current as any).downloadCanvas();
      setDownloadTrigger(false);
    }
  }, [downloadTrigger, setDownloadTrigger]);

  useEffect(() => {
    if (downloadSvgTrigger && p5Instance.current && setDownloadSvgTrigger) {
      (p5Instance.current as any).downloadSvg();
      setDownloadSvgTrigger(false);
      if (onShowNotification) {
        onShowNotification('SVG Vector Artwork downloaded successfully!', 'success');
      }
    }
  }, [downloadSvgTrigger, setDownloadSvgTrigger, onShowNotification]);

  useEffect(() => {
    if (copySvgTrigger && p5Instance.current && setCopySvgTrigger) {
      (p5Instance.current as any).copySvgToClipboard(
        (msg) => {
          setCopySvgTrigger(false);
          if (onShowNotification) {
            onShowNotification(msg, 'success');
          }
        },
        (err) => {
          setCopySvgTrigger(false);
          if (onShowNotification) {
            onShowNotification(err, 'error');
          }
        }
      );
    }
  }, [copySvgTrigger, setCopySvgTrigger, onShowNotification]);

  useEffect(() => {
    if (undoTrigger && p5Instance.current) {
      (p5Instance.current as any).undo();
      setUndoTrigger(false);
    }
  }, [undoTrigger, setUndoTrigger]);

  useEffect(() => {
    if (redoTrigger && p5Instance.current) {
      (p5Instance.current as any).redo();
      setRedoTrigger(false);
    }
  }, [redoTrigger, setRedoTrigger]);

  useEffect(() => {
    if (deleteTrigger && p5Instance.current) {
      (p5Instance.current as any).deleteSelected();
      setDeleteTrigger(false);
    }
  }, [deleteTrigger, setDeleteTrigger]);

  useEffect(() => {
    if (copyTrigger && p5Instance.current) {
      (p5Instance.current as any).copySelected();
      setCopyTrigger(false);
    }
  }, [copyTrigger, setCopyTrigger]);

  useEffect(() => {
    if (finishPathTrigger && p5Instance.current) {
      (p5Instance.current as any).finishActivePath();
      setFinishPathTrigger(false);
    }
  }, [finishPathTrigger, setFinishPathTrigger]);

  useEffect(() => {
    if (shapePreviewTrigger !== null && p5Instance.current) {
      (p5Instance.current as any).previewShape(shapePreviewTrigger.simplify, shapePreviewTrigger.smooth);
    }
  }, [shapePreviewTrigger]);

  useEffect(() => {
    if (shapeCommitTrigger && p5Instance.current) {
      (p5Instance.current as any).commitShape();
      setShapeCommitTrigger(false);
    }
  }, [shapeCommitTrigger, setShapeCommitTrigger]);

  // Reference image opacity isn't part of undo/redo, so it's just watched directly —
  // no debounce/commit dance needed, unlike Simplify/Smooth.
  useEffect(() => {
    if (p5Instance.current) {
      (p5Instance.current as any).setReferenceOpacity(referenceOpacity);
    }
  }, [referenceOpacity]);

  useEffect(() => {
    if (p5Instance.current) {
      (p5Instance.current as any).setReferenceLocked(referenceLocked);
    }
  }, [referenceLocked]);

  useEffect(() => {
    if (removeReferenceTrigger && p5Instance.current && setRemoveReferenceTrigger) {
      (p5Instance.current as any).removeReferenceImage();
      setRemoveReferenceTrigger(false);
    }
  }, [removeReferenceTrigger, setRemoveReferenceTrigger]);

  // Upload button path (App.tsx creates a fresh object each time, even for the same file,
  // so re-uploading the same image still retriggers this)
  useEffect(() => {
    if (referenceImageRequest && p5Instance.current) {
      (p5Instance.current as any).setReferenceImageFromDataUrl(referenceImageRequest.dataUrl);
    }
  }, [referenceImageRequest]);

  useEffect(() => {
    if (importStrokesRequest && p5Instance.current) {
      (p5Instance.current as any).importStrokes(importStrokesRequest.strokes);
    }
  }, [importStrokesRequest]);

  // Handles Cmd/Ctrl+V via the browser's real `paste` event rather than intercepting the
  // keydown — calling preventDefault() on the keydown itself suppresses this event before
  // it ever fires, which is what silently broke pasting entirely. If the clipboard holds an
  // image, it becomes the reference/trace image; otherwise it falls back to duplicating the
  // last-copied stroke.
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (!file) continue;
            e.preventDefault();
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result as string;
              if (p5Instance.current) {
                (p5Instance.current as any).setReferenceImageFromDataUrl(dataUrl);
              }
            };
            reader.readAsDataURL(file);
            return;
          }
        }
      }

      e.preventDefault();
      if (p5Instance.current) {
        (p5Instance.current as any).pasteClipboard();
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  useEffect(() => {
    if (toggleClosedTrigger && p5Instance.current && setToggleClosedTrigger) {
      (p5Instance.current as any).toggleClosedSelected();
      setToggleClosedTrigger(false);
    }
  }, [toggleClosedTrigger, setToggleClosedTrigger]);

  useEffect(() => {
    if (config.tool !== 'bezier' && p5Instance.current) {
      (p5Instance.current as any).finishActivePath();
    }
  }, [config.tool]);

  useEffect(() => {
    if (p5Instance.current) {
      (p5Instance.current as any).updateStrokeParams(config.width, config.color, config.cap);
    }
  }, [config.width, config.color, config.cap]);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 z-0 touch-none ${config.tool === 'move' || isSpaceHeld ? 'cursor-grab active:cursor-grabbing' : ''}`}
    />
  );
};

export default CalligraphyCanvas;
