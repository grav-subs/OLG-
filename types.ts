export type DrawingTool = 'brush' | 'bezier' | 'select' | 'move';

export interface StrokePoint {
  x: number;
  y: number;
}

export interface BezierAnchor {
  p: StrokePoint;   // Anchor point
  c1?: StrokePoint;  // Backward control point (for curve from previous anchor)
  c2?: StrokePoint;  // Forward control point (for curve to next anchor)
  isManuallyAdjusted?: boolean; // Flag to preserve manual handle shaping
}

export interface VectorStroke {
  id: string;
  tool: 'brush' | 'bezier' | 'dots';
  points: StrokePoint[];
  anchors?: BezierAnchor[];
  width: number;
  color: string;
  opacity: number;
  isClosed?: boolean;
  cap?: 'round' | 'square';
  name?: string;
  isVisible?: boolean;
  isLocked?: boolean;
  simplifyAmount?: number; // Last-applied Simplify slider value, remembered per-stroke
  smoothAmount?: number;   // Last-applied Smooth slider value, remembered per-stroke
}

export interface PenConfig {
  width: number;       // Width in pixels (5-200)
  color: string;       // Hex color code
  opacity: number;     // 0-1
  smoothing: number;   // 0-1 (Lerp factor)
  isDots: boolean;     // Toggle for dot/stippling mode
  showGrid: boolean;   // Toggle for background grid
  snapToGrid: boolean; // Toggle for snapping to grid intersections
  gridSize: number;    // Size of the grid cells
  tool: DrawingTool;   // Active tool
  bgColor: string;     // Canvas background color
  cap: 'round' | 'square';
}

export const INITIAL_CONFIG: PenConfig = {
  width: 40,
  color: '#D79B77', // Default Ink Color
  opacity: 1.0,   // Force ink density (opacity) to always be 1.0 (100%)
  smoothing: 1.0, // Force smoothing to always be 1.0 (100%)
  isDots: false,
  showGrid: false,
  snapToGrid: false,
  gridSize: 50,
  tool: 'brush',
  bgColor: '#FFFBF1', // Default background color
  cap: 'round'
};

export const BG_COLORS = [
  '#FFFBF1', // Warm Cream
  '#232049', // Deep Purple-Blue
  '#0E5642', // Deep Forest Green
  'transparent', // Transparent
];

export const COLORS = [
  '#D79B77', // Terracotta
  '#DAB5CF', // Lavender Rose
];
