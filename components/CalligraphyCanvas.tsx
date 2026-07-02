import React, { useEffect, useRef } from 'react';
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
  finishPathTrigger: boolean;
  setFinishPathTrigger: React.Dispatch<React.SetStateAction<boolean>>;
  smoothTrigger: boolean;
  setSmoothTrigger: React.Dispatch<React.SetStateAction<boolean>>;
  toggleClosedTrigger?: boolean;
  setToggleClosedTrigger?: React.Dispatch<React.SetStateAction<boolean>>;
  
  onStrokesChange?: (strokes: VectorStroke[]) => void;
  onSelectedStrokeIdChange?: (id: string | null) => void;
  layerActionTrigger?: {
    type: 'select' | 'delete' | 'toggleVisibility' | 'toggleLock' | 'rename' | 'moveUp' | 'moveDown' | 'bringToFront' | 'sendToBack';
    strokeId: string;
    value?: any;
  } | null;
  setLayerActionTrigger?: React.Dispatch<React.SetStateAction<{
    type: 'select' | 'delete' | 'toggleVisibility' | 'toggleLock' | 'rename' | 'moveUp' | 'moveDown' | 'bringToFront' | 'sendToBack';
    strokeId: string;
    value?: any;
  } | null>>;
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
  finishPathTrigger,
  setFinishPathTrigger,
  smoothTrigger,
  setSmoothTrigger,
  toggleClosedTrigger,
  setToggleClosedTrigger,
  onStrokesChange,
  onSelectedStrokeIdChange,
  layerActionTrigger,
  setLayerActionTrigger
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const p5Instance = useRef<p5 | null>(null);
  const configRef = useRef(config);

  const onStrokesChangeRef = useRef(onStrokesChange);
  const onSelectedStrokeIdChangeRef = useRef(onSelectedStrokeIdChange);

  useEffect(() => {
    onStrokesChangeRef.current = onStrokesChange;
  }, [onStrokesChange]);

  useEffect(() => {
    onSelectedStrokeIdChangeRef.current = onSelectedStrokeIdChange;
  }, [onSelectedStrokeIdChange]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    if (!containerRef.current) return;

    const sketch = (p: p5) => {
      let strokes: VectorStroke[] = [];
      let history: VectorStroke[][] = [[]];
      let historyIndex = 0;

      const notifyStrokesChanged = () => {
        if (onStrokesChangeRef.current) {
          onStrokesChangeRef.current(strokes.map(s => ({
            id: s.id,
            tool: s.tool,
            points: s.points ? [...s.points] : [],
            anchors: s.anchors ? JSON.parse(JSON.stringify(s.anchors)) : undefined,
            width: s.width,
            color: s.color,
            opacity: s.opacity,
            isClosed: s.isClosed,
            cap: s.cap,
            name: s.name,
            isVisible: s.isVisible,
            isLocked: s.isLocked
          })));
        }
      };

      const notifySelectedStrokeIdChanged = () => {
        if (onSelectedStrokeIdChangeRef.current) {
          onSelectedStrokeIdChangeRef.current(selectedStroke ? selectedStroke.id : null);
        }
      };

      let activeStroke: VectorStroke | null = null;
      let selectedStroke: VectorStroke | null = null;
      let hoveredStroke: VectorStroke | null = null;

      let isDrawing = false;
      let prevMouse: p5.Vector | null = null;
      let smoothedMouse: p5.Vector | null = null;

      // Direct selection drag state
      let draggingItem: {
        strokeId: string;
        type: 'anchor' | 'control1' | 'control2' | 'stroke';
        index: number;
      } | null = null;

      // Multi-anchor selection state (Figma & Illustrator style)
      interface SelectedAnchor {
        strokeId: string;
        index: number;
      }
      let selectedAnchors: SelectedAnchor[] = [];
      let marqueeStart: p5.Vector | null = null;
      let isMarqueeDragging = false;

      p.setup = () => {
        p.createCanvas(p.windowWidth, p.windowHeight);
        notifyStrokesChanged();
        notifySelectedStrokeIdChanged();
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
        notifyStrokesChanged();
        notifySelectedStrokeIdChanged();
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
        const pointSnapThreshold = 18;
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
        const alignThreshold = 10;
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
          const threshold = Math.max(stroke.width / 2, 8) + 12; // generous hit-box

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
        if (configRef.current.bgColor === 'transparent') {
          p.background('#ffffff');
        } else {
          p.background(configRef.current.bgColor || '#FFFBF1');
        }
        
        // Grid removed

        // Check hover if we are in select tool and not drawing/dragging
        if (configRef.current.tool === 'select' && !isDrawing && !draggingItem) {
          hoveredStroke = getStrokeUnderMouse(p.mouseX, p.mouseY);
        } else {
          hoveredStroke = null;
        }

        // Draw all completed strokes
        for (const stroke of strokes) {
          if (stroke.isVisible === false) continue;
          const isSelected = selectedStroke && selectedStroke.id === stroke.id;
          const isHovered = hoveredStroke && hoveredStroke.id === stroke.id;

          p.push();

          // Highlight selection or hover
          if (isSelected || isHovered) {
            p.push();
            p.noFill();
            p.strokeWeight(stroke.width + 8);
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
              const cursor = getPosition(p.mouseX, p.mouseY);
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
        const cursor = getPosition(p.mouseX, p.mouseY);
        const { width, color, tool } = configRef.current;

        if (p.mouseX > 0 && p.mouseX < p.width && p.mouseY > 0 && p.mouseY < p.height) {
          p.push();
          p.translate(cursor.x, cursor.y);
          
          if (tool === 'select') {
            // Subtle pointer cursor
            p.stroke('#3b82f6');
            p.strokeWeight(2);
            p.noFill();
            p.circle(0, 0, 8);
          } else {
            // Brush / Pen foot footprint
            p.stroke(color);
            p.strokeWeight(1);
            p.noFill();
            p.circle(0, 0, width);
            p.strokeWeight(3);
            p.point(0, 0);
          }
          p.pop();
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

              // Draw handle 1
              if (anchor.c1 && (anchor.c1.x !== anchor.p.x || anchor.c1.y !== anchor.p.y)) {
                p.stroke('rgba(59, 130, 246, 0.5)');
                p.strokeWeight(1.5);
                p.line(anchor.p.x, anchor.p.y, anchor.c1.x, anchor.c1.y);
                p.fill('#ffffff');
                p.stroke('#3b82f6');
                p.circle(anchor.c1.x, anchor.c1.y, 9);
              }

              // Draw handle 2
              if (anchor.c2 && (anchor.c2.x !== anchor.p.x || anchor.c2.y !== anchor.p.y)) {
                p.stroke('rgba(59, 130, 246, 0.5)');
                p.strokeWeight(1.5);
                p.line(anchor.p.x, anchor.p.y, anchor.c2.x, anchor.c2.y);
                p.fill('#ffffff');
                p.stroke('#3b82f6');
                p.circle(anchor.c2.x, anchor.c2.y, 9);
              }

              // Draw anchor point itself (Figma & Illustrator style: hollow when unselected, filled when selected!)
              if (isAnchorSelected) {
                p.fill('#3b82f6');
                p.stroke('#ffffff');
                p.strokeWeight(2.5);
                p.circle(anchor.p.x, anchor.p.y, 14);
              } else {
                p.fill('#ffffff');
                p.stroke('#3b82f6');
                p.strokeWeight(2.5);
                p.circle(anchor.p.x, anchor.p.y, 13);
              }
              
              // Mark index or highlights
              if (i === 0) {
                p.push();
                p.stroke('#3b82f6');
                p.strokeWeight(1.5);
                p.fill(isAnchorSelected ? '#3b82f6' : '#ffffff');
                p.rectMode(p.CENTER);
                p.square(anchor.p.x, anchor.p.y, isAnchorSelected ? 8 : 6); // visual square start marker
                p.pop();
              }
            }
            p.pop();
          }
        }

        // Render Smart Magnetic Alignment Guides & Point Snapping Indicators
        if (activeSnapGuides.length > 0) {
          p.push();
          p.stroke('#6366f1'); // Premium Indigo-500 color for smart guides
          p.strokeWeight(1.2);
          // Set a dash pattern: 5px line, 5px space
          (p.drawingContext as CanvasRenderingContext2D).setLineDash([5, 5]);
          
          for (const guide of activeSnapGuides) {
            if (guide.type === 'v') {
              // Draw line from reference anchor to current cursor
              p.line(guide.refX, guide.refY, guide.val, cursor.y);
              
              // Draw a tiny alignment indicator on the reference anchor
              p.push();
              p.noStroke();
              p.fill('rgba(99, 102, 241, 0.25)');
              p.circle(guide.refX, guide.refY, 18);
              p.pop();
            } else if (guide.type === 'h') {
              // Draw line from reference anchor to current cursor
              p.line(guide.refX, guide.refY, cursor.x, guide.val);
              
              // Draw a tiny alignment indicator on the reference anchor
              p.push();
              p.noStroke();
              p.fill('rgba(99, 102, 241, 0.25)');
              p.circle(guide.refX, guide.refY, 18);
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
          p.strokeWeight(1.5);
          // Concentric magnetic rings
          p.circle(activeSnapPoint.x, activeSnapPoint.y, 14);
          p.stroke('rgba(236, 72, 153, 0.4)');
          p.circle(activeSnapPoint.x, activeSnapPoint.y, 24);
          p.fill('#ec4899');
          p.noStroke();
          p.circle(activeSnapPoint.x, activeSnapPoint.y, 5);
          p.pop();
        }

        // Render Marquee Selection Box
        if (isMarqueeDragging && marqueeStart) {
          p.push();
          p.stroke('rgba(59, 130, 246, 0.85)'); // Nice Tailwind blue border
          p.strokeWeight(1.5);
          (p.drawingContext as CanvasRenderingContext2D).setLineDash([4, 4]);
          p.fill('rgba(59, 130, 246, 0.08)'); // Semi-transparent blue fill
          
          const x = marqueeStart.x;
          const y = marqueeStart.y;
          const w = p.mouseX - x;
          const h = p.mouseY - y;
          p.rect(x, y, w, h, 2);
          
          p.pop();
        }
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
        const clickedPos = getPosition(p.mouseX, p.mouseY);
        const mx = p.mouseX;
        const my = p.mouseY;

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

              if (distAnchor < 16) {
                handleAnchorClick(activeStroke.id, i);
                draggingItem = { strokeId: activeStroke.id, type: 'anchor', index: i };
                prevMouse = p.createVector(mx, my);
                isDrawing = false; // We are dragging, not adding a new point
                return;
              }
              if (anchor.c1) {
                const distC1 = p.dist(mx, my, anchor.c1.x, anchor.c1.y);
                if (distC1 < 14) {
                  draggingItem = { strokeId: activeStroke.id, type: 'control1', index: i };
                  prevMouse = p.createVector(mx, my);
                  isDrawing = false;
                  return;
                }
              }
              if (anchor.c2) {
                const distC2 = p.dist(mx, my, anchor.c2.x, anchor.c2.y);
                if (distC2 < 14) {
                  draggingItem = { strokeId: activeStroke.id, type: 'control2', index: i };
                  prevMouse = p.createVector(mx, my);
                  isDrawing = false;
                  return;
                }
              }
            }
          }

          // 2. Second priority: Check if we clicked on any anchor or control point of the currently selectedStroke
          if (selectedStroke && !selectedStroke.isLocked && selectedStroke.isVisible !== false && selectedStroke.tool === 'bezier' && selectedStroke.anchors) {
            for (let i = 0; i < selectedStroke.anchors.length; i++) {
              const anchor = selectedStroke.anchors[i];
              const distAnchor = p.dist(mx, my, anchor.p.x, anchor.p.y);
              if (distAnchor < 16) {
                handleAnchorClick(selectedStroke.id, i);
                draggingItem = { strokeId: selectedStroke.id, type: 'anchor', index: i };
                prevMouse = p.createVector(mx, my);
                return;
              }
              if (anchor.c1) {
                const distC1 = p.dist(mx, my, anchor.c1.x, anchor.c1.y);
                if (distC1 < 14) {
                  draggingItem = { strokeId: selectedStroke.id, type: 'control1', index: i };
                  prevMouse = p.createVector(mx, my);
                  return;
                }
              }
              if (anchor.c2) {
                const distC2 = p.dist(mx, my, anchor.c2.x, anchor.c2.y);
                if (distC2 < 14) {
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
                if (distAnchor < 16) {
                  selectedStroke = stroke;
                  handleAnchorClick(stroke.id, i);
                  draggingItem = { strokeId: stroke.id, type: 'anchor', index: i };
                  prevMouse = p.createVector(mx, my);
                  return;
                }
              }
            }
          }
        }

        // --- Standard Tool Click Handling ---
        if (tool === 'select') {
          const hit = getStrokeUnderMouse(p.mouseX, p.mouseY);
          if (hit) {
            selectedStroke = hit;
            // Clear prior selected anchors unless Shift is held down
            if (!p.keyIsDown(p.SHIFT)) {
              selectedAnchors = [];
            }
            // Also allow dragging the entire selected stroke smoothly
            draggingItem = { strokeId: hit.id, type: 'stroke', index: -1 };
            prevMouse = p.createVector(p.mouseX, p.mouseY);
          } else {
            // Clicked empty space
            if (!p.keyIsDown(p.SHIFT)) {
              selectedStroke = null;
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
            if (distToStart < 16) {
              // Close and complete
              activeStroke.isClosed = true;
              
              // Recalculate control points of the closed loop to make the start/end connection perfectly smooth
              const currentTension = 0.35;
              const smoothed = computeControlPoints(activeStroke.anchors!.map(a => a.p), true, currentTension, activeStroke.anchors);
              activeStroke.anchors = smoothed;

              strokes.push(activeStroke);
              selectedStroke = activeStroke;
              activeStroke = null;
              isDrawing = false;
              saveState();
              return;
            }
          }

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
        notifySelectedStrokeIdChanged();
      };

      p.mouseDragged = () => {
        if (isMarqueeDragging) {
          return;
        }
        const { tool, smoothing } = configRef.current;
        const targetPos = getPosition(p.mouseX, p.mouseY);
        const currentMouse = p.createVector(p.mouseX, p.mouseY);

        if (draggingItem) {
          const sIndex = strokes.findIndex(s => s.id === draggingItem!.strokeId);
          const targetStroke = sIndex !== -1 ? strokes[sIndex] : activeStroke;
          
          if (targetStroke) {
            if (draggingItem.type === 'stroke') {
              if (prevMouse) {
                const dx = currentMouse.x - prevMouse.x;
                const dy = currentMouse.y - prevMouse.y;
                
                if (targetStroke.anchors) {
                  for (const anchor of targetStroke.anchors) {
                    anchor.p.x += dx;
                    anchor.p.y += dy;
                    if (anchor.c1) { anchor.c1.x += dx; anchor.c1.y += dy; }
                    if (anchor.c2) { anchor.c2.x += dx; anchor.c2.y += dy; }
                  }
                }
                if (targetStroke.points) {
                  for (const pt of targetStroke.points) {
                    pt.x += dx;
                    pt.y += dy;
                  }
                }
                prevMouse = currentMouse;
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
        
        // Handle Marquee Selection Completion
        if (isMarqueeDragging && marqueeStart) {
          isMarqueeDragging = false;
          
          const endX = p.mouseX;
          const endY = p.mouseY;
          
          const x1 = Math.min(marqueeStart.x, endX);
          const x2 = Math.max(marqueeStart.x, endX);
          const y1 = Math.min(marqueeStart.y, endY);
          const y2 = Math.max(marqueeStart.y, endY);
          
          const widthSel = x2 - x1;
          const heightSel = y2 - y1;
          
          // Only perform selection if the marquee box is larger than a tiny threshold (e.g., 4px) to avoid accidental clicks clearing state
          if (widthSel > 4 && heightSel > 4) {
            const newlySelected: SelectedAnchor[] = [];
            
            // If we already have a selectedStroke, prioritize selecting anchors within it
            if (selectedStroke && selectedStroke.tool === 'bezier' && selectedStroke.anchors) {
              for (let i = 0; i < selectedStroke.anchors.length; i++) {
                const anchor = selectedStroke.anchors[i];
                if (anchor.p.x >= x1 && anchor.p.x <= x2 && anchor.p.y >= y1 && anchor.p.y <= y2) {
                  newlySelected.push({ strokeId: selectedStroke.id, index: i });
                }
              }
            } else {
              // Otherwise, search all strokes for anchors inside the marquee box
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
              // If we found anchors, let's set selectedStroke to the first found anchor's stroke
              if (newlySelected.length > 0) {
                const firstId = newlySelected[0].strokeId;
                const foundStroke = strokes.find(s => s.id === firstId);
                if (foundStroke) {
                  selectedStroke = foundStroke;
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
          draggingItem = null;
          saveState(); // save after anchor dragging finishes
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
              
              let resampled = [...simplified];
              
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
            }
            strokes.push(activeStroke);
            selectedStroke = activeStroke;
            activeStroke = null;
            saveState();
          }
        }
        prevMouse = null;
        smoothedMouse = null;
        notifySelectedStrokeIdChanged();
      };

      p.keyPressed = () => {
        if (p.keyCode === p.ENTER || p.keyCode === p.ESCAPE) {
          (p as any).finishActivePath();
        }
        if (p.keyCode === p.DELETE || p.keyCode === p.BACKSPACE) {
          (p as any).deleteSelected();
        }
      };

      // Exposed command methods called via triggers
      (p as any).finishActivePath = () => {
        if (activeStroke && activeStroke.tool === 'bezier') {
          if (activeStroke.anchors && activeStroke.anchors.length > 1) {
            // Apply a final smoothing pass to ensure open paths have perfect curvature, preserving any manually adjusted points
            const currentTension = 0.35;
            const smoothed = computeControlPoints(activeStroke.anchors.map(a => a.p), activeStroke.isClosed, currentTension, activeStroke.anchors);
            activeStroke.anchors = smoothed;
            strokes.push(activeStroke);
            selectedStroke = activeStroke;
          }
          activeStroke = null;
          saveState();
        }
      };

      (p as any).deleteSelected = () => {
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
                selectedStroke = null;
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
              saveState();
              return;
            }
          }
          
          // Fallback: delete the entire stroke if no specific anchors are highlighted
          strokes = strokes.filter(s => s.id !== selectedStroke!.id);
          selectedStroke = null;
          selectedAnchors = [];
          saveState();
        }
      };

      (p as any).smoothSelected = () => {
        if (selectedStroke && selectedStroke.tool === 'bezier') {
          if (selectedStroke.anchors && selectedStroke.anchors.length > 1) {
            // Explicit auto-smoothing resets manual handles to fully smooth flow
            for (const a of selectedStroke.anchors) {
              delete a.isManuallyAdjusted;
            }
            
            // Apply 1 pass of gentle [0.15, 0.7, 0.15] binomial smoothing over the anchor coordinates
            const tempPoints = selectedStroke.anchors.map(a => ({ x: a.p.x, y: a.p.y }));
            const n = tempPoints.length;
            const isClosed = !!selectedStroke.isClosed;
            
            if (n > 2) {
              if (isClosed) {
                for (let i = 0; i < n; i++) {
                  const prev = tempPoints[(i - 1 + n) % n];
                  const curr = tempPoints[i];
                  const next = tempPoints[(i + 1) % n];
                  selectedStroke.anchors[i].p = {
                    x: curr.x * 0.7 + (prev.x + next.x) * 0.15,
                    y: curr.y * 0.7 + (prev.y + next.y) * 0.15
                  };
                }
              } else {
                for (let i = 1; i < n - 1; i++) {
                  const prev = tempPoints[i - 1];
                  const curr = tempPoints[i];
                  const next = tempPoints[i + 1];
                  selectedStroke.anchors[i].p = {
                    x: curr.x * 0.7 + (prev.x + next.x) * 0.15,
                    y: curr.y * 0.7 + (prev.y + next.y) * 0.15
                  };
                }
              }
            }
            
            const currentTension = 0.35;
            const smoothed = computeControlPoints(selectedStroke.anchors.map(a => a.p), selectedStroke.isClosed, currentTension);
            selectedStroke.anchors = smoothed;
            saveState();
          }
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
        selectedStroke = null;
        saveState();
      };

      (p as any).undo = () => {
        if (historyIndex > 0) {
          historyIndex--;
          strokes = JSON.parse(JSON.stringify(history[historyIndex]));
          selectedStroke = null;
          activeStroke = null;
          notifyStrokesChanged();
          notifySelectedStrokeIdChanged();
        }
      };

      (p as any).redo = () => {
        if (historyIndex < history.length - 1) {
          historyIndex++;
          strokes = JSON.parse(JSON.stringify(history[historyIndex]));
          selectedStroke = null;
          activeStroke = null;
          notifyStrokesChanged();
          notifySelectedStrokeIdChanged();
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

      (p as any).handleLayerAction = (
        type: 'select' | 'delete' | 'toggleVisibility' | 'toggleLock' | 'rename' | 'moveUp' | 'moveDown' | 'bringToFront' | 'sendToBack',
        strokeId: string,
        value?: any
      ) => {
        let changed = false;
        
        if (type === 'select') {
          const target = strokes.find(s => s.id === strokeId);
          if (target && !target.isLocked && target.isVisible !== false) {
            selectedStroke = target;
          } else {
            selectedStroke = null;
          }
          notifySelectedStrokeIdChanged();
          return;
        }
        
        if (type === 'delete') {
          strokes = strokes.filter(s => s.id !== strokeId);
          if (selectedStroke?.id === strokeId) {
            selectedStroke = null;
            notifySelectedStrokeIdChanged();
          }
          changed = true;
        } else if (type === 'toggleVisibility') {
          strokes = strokes.map(s => {
            if (s.id === strokeId) {
              const nextVisible = s.isVisible === false ? true : false;
              if (!nextVisible && selectedStroke?.id === strokeId) {
                selectedStroke = null;
                notifySelectedStrokeIdChanged();
              }
              return { ...s, isVisible: nextVisible };
            }
            return s;
          });
          changed = true;
        } else if (type === 'toggleLock') {
          strokes = strokes.map(s => {
            if (s.id === strokeId) {
              const nextLocked = !s.isLocked;
              if (nextLocked && selectedStroke?.id === strokeId) {
                selectedStroke = null;
                notifySelectedStrokeIdChanged();
              }
              return { ...s, isLocked: nextLocked };
            }
            return s;
          });
          changed = true;
        } else if (type === 'rename') {
          strokes = strokes.map(s => {
            if (s.id === strokeId) {
              return { ...s, name: value as string };
            }
            return s;
          });
          changed = true;
        } else if (type === 'moveUp') {
          const idx = strokes.findIndex(s => s.id === strokeId);
          if (idx !== -1 && idx < strokes.length - 1) {
            const temp = strokes[idx];
            strokes[idx] = strokes[idx + 1];
            strokes[idx + 1] = temp;
            changed = true;
          }
        } else if (type === 'moveDown') {
          const idx = strokes.findIndex(s => s.id === strokeId);
          if (idx !== -1 && idx > 0) {
            const temp = strokes[idx];
            strokes[idx] = strokes[idx - 1];
            strokes[idx - 1] = temp;
            changed = true;
          }
        } else if (type === 'bringToFront') {
          const idx = strokes.findIndex(s => s.id === strokeId);
          if (idx !== -1 && idx < strokes.length - 1) {
            const temp = strokes[idx];
            strokes.splice(idx, 1);
            strokes.push(temp);
            changed = true;
          }
        } else if (type === 'sendToBack') {
          const idx = strokes.findIndex(s => s.id === strokeId);
          if (idx !== -1 && idx > 0) {
            const temp = strokes[idx];
            strokes.splice(idx, 1);
            strokes.unshift(temp);
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
    if (finishPathTrigger && p5Instance.current) {
      (p5Instance.current as any).finishActivePath();
      setFinishPathTrigger(false);
    }
  }, [finishPathTrigger, setFinishPathTrigger]);

  useEffect(() => {
    if (smoothTrigger && p5Instance.current) {
      (p5Instance.current as any).smoothSelected();
      setSmoothTrigger(false);
    }
  }, [smoothTrigger, setSmoothTrigger]);

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

  useEffect(() => {
    if (layerActionTrigger && p5Instance.current) {
      const { type, strokeId, value } = layerActionTrigger;
      (p5Instance.current as any).handleLayerAction(type, strokeId, value);
      if (setLayerActionTrigger) {
        setLayerActionTrigger(null);
      }
    }
  }, [layerActionTrigger, setLayerActionTrigger]);

  return <div ref={containerRef} className="absolute inset-0 z-0 touch-none" />;
};

export default CalligraphyCanvas;
