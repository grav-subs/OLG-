import { VectorStroke, StrokePoint } from '../types';

/**
 * Converts a sequence of points rendered with p5.js curveVertex (Catmull-Rom spline)
 * to a series of high-quality cubic Bezier path commands in SVG.
 */
export function catmullRomToSvgPath(points: StrokePoint[], isClosed: boolean = false): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  if (points.length === 2) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;

  // To replicate p5's drawing style perfectly:
  // p5 repeats the first and last points as control points for curveVertex.
  const vertices: StrokePoint[] = [
    points[0], // control point
    ...points, // actual points
    points[points.length - 1] // control point
  ];

  let path = `M ${vertices[1].x.toFixed(1)} ${vertices[1].y.toFixed(1)}`;
  
  for (let i = 1; i < vertices.length - 2; i++) {
    const p0 = vertices[i - 1];
    const p1 = vertices[i];
    const p2 = vertices[i + 1];
    const p3 = vertices[i + 2];

    // Standard tension factor of 0.5 (corresponds to factor of 1/6)
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  if (isClosed) {
    path += ' Z';
  }
  return path;
}

/**
 * Generates a clean, fully-scalable, high-quality SVG string of the drawing canvas.
 */
export function generateSvgString(strokes: VectorStroke[], width: number, height: number, bgColor: string = '#f5f5f4'): string {
  const paths: string[] = [];

  for (const stroke of strokes) {
    if (stroke.isVisible === false) continue;
    let d = '';

    if (stroke.tool === 'bezier' && stroke.anchors) {
      const anchors = stroke.anchors;
      if (anchors.length > 0) {
        d += `M ${anchors[0].p.x.toFixed(1)} ${anchors[0].p.y.toFixed(1)}`;
        
        for (let i = 0; i < anchors.length - 1; i++) {
          const a1 = anchors[i];
          const a2 = anchors[i + 1];
          const c1x = a1.c2 ? a1.c2.x : a1.p.x;
          const c1y = a1.c2 ? a1.c2.y : a1.p.y;
          const c2x = a2.c1 ? a2.c1.x : a2.p.x;
          const c2y = a2.c1 ? a2.c1.y : a2.p.y;
          
          d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${a2.p.x.toFixed(1)} ${a2.p.y.toFixed(1)}`;
        }
        
        if (stroke.isClosed && anchors.length > 2) {
          const aLast = anchors[anchors.length - 1];
          const aFirst = anchors[0];
          const c1x = aLast.c2 ? aLast.c2.x : aLast.p.x;
          const c1y = aLast.c2 ? aLast.c2.y : aLast.p.y;
          const c2x = aFirst.c1 ? aFirst.c1.x : aFirst.p.x;
          const c2y = aFirst.c1 ? aFirst.c1.y : aFirst.p.y;
          
          d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${aFirst.p.x.toFixed(1)} ${aFirst.p.y.toFixed(1)} Z`;
        }
      }
    } else {
      // Freehand/brush stroke
      d = catmullRomToSvgPath(stroke.points, stroke.isClosed);
    }

    if (d) {
      const strokeColor = stroke.color;
      const strokeWidth = stroke.width;
      const strokeOpacity = stroke.opacity ?? 1.0;
      
      const capStyle = stroke.cap === 'square' ? 'square' : 'round';
      const joinStyle = stroke.cap === 'square' ? 'miter' : 'round';
      
      paths.push(`    <path 
      d="${d}" 
      fill="none" 
      stroke="${strokeColor}" 
      stroke-width="${strokeWidth}" 
      stroke-linecap="${capStyle}" 
      stroke-linejoin="${joinStyle}" 
      stroke-opacity="${strokeOpacity.toFixed(2)}"
    />`);
    }
  }

  const backgroundElement = bgColor === 'transparent'
    ? '  <!-- Transparent background -->'
    : `  <!-- Background matches Calligraphy Studio canvas theme -->
  <rect width="100%" height="100%" fill="${bgColor}" />`;

  // Embed the original stroke data (anchors, control points, per-stroke Simplify/Smooth
  // memory — everything) so this exact file can be re-imported later as live editable
  // strokes, not just re-traced from its visual outline. Invisible to any normal SVG
  // viewer/editor; base64-encoded so it can sit as plain text with no XML-escaping
  // concerns (no risk of stray "]]>"-in-a-stroke-name breaking a CDATA section, etc).
  const metadataPayload = JSON.stringify({ app: 'digital-calligraphy-studio', version: 1, strokes });
  const metadataBase64 = btoa(unescape(encodeURIComponent(metadataPayload)));
  const metadataElement = `  <metadata id="digital-calligraphy-studio-data">${metadataBase64}</metadata>`;

  // Generate complete standalone SVG content
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 ${width} ${height}"
  width="${width}"
  height="${height}"
>
${metadataElement}
${backgroundElement}

  <g>
${paths.join('\n')}
  </g>
</svg>`;
}

/**
 * Extracts the original stroke data embedded by generateSvgString, for re-importing an
 * exported file as live editable strokes. Returns null if the file wasn't exported from
 * this app (no embedded metadata found, or it doesn't parse as expected).
 */
export function parseImportedSvgStrokes(svgText: string): VectorStroke[] | null {
  try {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return null;

    // getElementById is unreliable on XML documents (which is what DOMParser produces for
    // 'image/svg+xml') — it doesn't consistently recognize a plain id="..." attribute as an
    // actual ID outside HTML documents. An attribute selector matches the literal value
    // regardless, so it works consistently here.
    const metadataEl = doc.querySelector('[id="digital-calligraphy-studio-data"]');
    const base64 = metadataEl?.textContent?.trim();
    if (!base64) return null;

    const json = decodeURIComponent(escape(atob(base64)));
    const payload = JSON.parse(json);
    if (payload?.app !== 'digital-calligraphy-studio' || !Array.isArray(payload.strokes)) {
      return null;
    }
    return payload.strokes as VectorStroke[];
  } catch {
    return null;
  }
}
