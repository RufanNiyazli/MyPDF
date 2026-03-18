/**
 * pdfSaver.jsx
 *
 * Vector-based PDF annotation renderer.
 *
 * Strategy ("pristine-origin"):
 *   Every save starts from the PRISTINE original PDF bytes (the file as
 *   first opened, stored separately in IndexedDB). It then re-renders only
 *   the objects currently on the Fabric canvas as real PDF vector operations.
 *
 *   This means:
 *   - Deleting an object from the canvas guarantees it never appears in the
 *     next saved PDF — there are no accumulated PNG layers.
 *   - The file on disk after each save is exactly:
 *       pristine original  +  current Fabric annotations (as vectors)
 */

import { PDFDocument, rgb, degrees, StandardFonts } from "pdf-lib";
import { writeFile } from "@tauri-apps/plugin-fs";

// ─── Color helpers ────────────────────────────────────────────────────────────

const NAMED_COLORS = {
  black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 0.5, 0],
  blue: [0, 0, 1], yellow: [1, 1, 0], orange: [1, 0.65, 0],
  purple: [0.5, 0, 0.5], cyan: [0, 1, 1], magenta: [1, 0, 1],
  gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5], transparent: null,
};

/**
 * Parse a CSS color string into { r, g, b } (0–1 each) and opacity (0–1).
 * Returns null if the color is transparent / unparseable.
 */
function parseColor(str, baseOpacity = 1) {
  if (!str || str === "transparent" || str === "none") return null;

  // Named
  const lc = str.toLowerCase().trim();
  if (NAMED_COLORS[lc]) {
    const [r, g, b] = NAMED_COLORS[lc];
    return { color: rgb(r, g, b), opacity: baseOpacity };
  }
  if (lc === "transparent" || lc === "none") return null;

  // rgba(r,g,b,a)
  const rgba = lc.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (rgba) {
    const op = rgba[4] !== undefined ? parseFloat(rgba[4]) * baseOpacity : baseOpacity;
    return { color: rgb(+rgba[1] / 255, +rgba[2] / 255, +rgba[3] / 255), opacity: op };
  }

  // #RGB / #RRGGBB / #RRGGBBAA
  let h = lc.replace(/^#/, "");
  if (h.length === 3)  h = h.split("").map(c => c + c).join("");
  if (h.length === 6 || h.length === 8) {
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    // last two hex digits are alpha in #RRGGBBAA
    const a = h.length === 8 ? (parseInt(h.slice(6, 8), 16) / 255) * baseOpacity : baseOpacity;
    return { color: rgb(r, g, b), opacity: a };
  }

  return { color: rgb(0, 0, 0), opacity: baseOpacity }; // fallback to black
}

// ─── Coordinate helpers ───────────────────────────────────────────────────────

/**
 * Apply a Fabric 2-D affine matrix [a,b,c,d,e,f] to a local-space point.
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 */
function applyMatrix(matrix, x, y) {
  const [a, b, c, d, e, f] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

/**
 * Convert canvas-space coordinates to PDF-space coordinates.
 * Fabric: origin top-left,  y ↓
 * PDF:    origin bottom-left, y ↑
 */
function toPdf(canvasX, canvasY, sx, sy, pdfH) {
  return [canvasX * sx, pdfH - canvasY * sy];
}

// ─── SVG path builder for Fabric Path objects ─────────────────────────────────

/**
 * Convert a Fabric path-command array to a PDF-space SVG path string.
 *
 * @param {Array}  pathArray  Fabric's internal path array, e.g. [["M",x,y],["L",x,y],…]
 * @param {Array}  matrix     Result of obj.calcTransformMatrix()
 * @param {number} sx, sy     Canvas → PDF coordinate scale factors
 * @param {number} pdfH       PDF page height (PDF points)
 * @returns {string}          SVG path string in PDF coordinate space
 */
function fabricPathToPdfSvg(pathArray, matrix, sx, sy, pdfH) {
  const xf = (x, y) => {
    const [cx, cy] = applyMatrix(matrix, x, y);
    return toPdf(cx, cy, sx, sy, pdfH);
  };

  const parts = [];
  for (const cmd of pathArray) {
    switch (cmd[0].toUpperCase()) {
      case "M": { const [px, py] = xf(cmd[1], cmd[2]); parts.push(`M ${px} ${py}`); break; }
      case "L": { const [px, py] = xf(cmd[1], cmd[2]); parts.push(`L ${px} ${py}`); break; }
      case "H": {
        // Horizontal line — need Y from previous point. Approximate via L.
        // We don't track previous Y precisely here; just emit L with same Y as last M/L.
        // This is rare in Fabric pencil output; treat as L with y=0 in local space.
        const [px, py] = xf(cmd[1], 0);
        parts.push(`L ${px} ${py}`);
        break;
      }
      case "V": { const [px, py] = xf(0, cmd[1]); parts.push(`L ${px} ${py}`); break; }
      case "Q": {
        const [cpx, cpy] = xf(cmd[1], cmd[2]);
        const [px,  py ] = xf(cmd[3], cmd[4]);
        parts.push(`Q ${cpx} ${cpy} ${px} ${py}`);
        break;
      }
      case "C": {
        const [cp1x, cp1y] = xf(cmd[1], cmd[2]);
        const [cp2x, cp2y] = xf(cmd[3], cmd[4]);
        const [px,   py  ] = xf(cmd[5], cmd[6]);
        parts.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${px} ${py}`);
        break;
      }
      case "Z": parts.push("Z"); break;
      default: break;
    }
  }
  return parts.join(" ");
}

// ─── Per-object renderer ──────────────────────────────────────────────────────

/**
 * Render a single Fabric object (or group) onto a pdf-lib PDFPage.
 *
 * @param {PDFPage}  page
 * @param {object}   obj          Plain-object from canvas.toJSON() or live FabricObject
 * @param {number}   sx, sy       Scale factors: canvas px → PDF points
 * @param {number}   pdfH         PDF page height in points
 * @param {PDFDocument} pdfDoc    Needed for font embedding
 * @param {PDFFont}  helvetica    Pre-embedded Helvetica font
 * @param {Array}    parentMatrix Optional parent group transform matrix
 */
async function renderObject(page, obj, sx, sy, pdfH, pdfDoc, helvetica, parentMatrix) {
  // Build composite transform: parent × own.
  // calcTransformMatrix() is only on live FabricObject instances; for plain JSON objects
  // we reconstruct manually using the stored properties.
  const matrix = computeMatrix(obj, parentMatrix);

  const globalOpacity = (obj.opacity ?? 1) * (parentMatrix ? 1 : 1);
  const type = (obj.type || "").toLowerCase();

  try {
    if (type === "path") {
      await renderPath(page, obj, matrix, sx, sy, pdfH, globalOpacity);
    } else if (type === "rect") {
      renderRect(page, obj, matrix, sx, sy, pdfH, globalOpacity);
    } else if (type === "ellipse") {
      renderEllipse(page, obj, matrix, sx, sy, pdfH, globalOpacity);
    } else if (type === "textbox" || type === "itext" || type === "text") {
      renderText(page, obj, matrix, sx, sy, pdfH, globalOpacity, helvetica);
    } else if (type === "line") {
      renderLine(page, obj, matrix, sx, sy, pdfH, globalOpacity);
    } else if (type === "group") {
      const children = obj.objects ?? obj._objects ?? [];
      for (const child of children) {
        await renderObject(page, child, sx, sy, pdfH, pdfDoc, helvetica, matrix);
      }
    }
    // Polyline, polygon, etc. fall through silently.
  } catch (err) {
    console.warn(`[pdfSaver] Could not render object of type "${type}":`, err);
  }
}

// ─── Matrix computation from serialised Fabric JSON ──────────────────────────

/**
 * Reconstruct the 2-D affine transform matrix [a,b,c,d,e,f] for a plain
 * Fabric JSON object. Mirrors Fabric's own calcTransformMatrix() logic.
 *
 * @param {object} obj           Plain Fabric JSON object (from toJSON())
 * @param {Array|null} parentMtx Parent group matrix to pre-multiply into
 * @returns {number[]}           [a, b, c, d, e, f]
 */
function computeMatrix(obj, parentMtx) {
  const angle = ((obj.angle ?? 0) * Math.PI) / 180;
  const scaleX  = obj.scaleX  ?? 1;
  const scaleY  = obj.scaleY  ?? 1;
  const flipX   = obj.flipX   ? -1 : 1;
  const flipY   = obj.flipY   ? -1 : 1;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const skewX = Math.tan((obj.skewX ?? 0) * Math.PI / 180);
  const skewY = Math.tan((obj.skewY ?? 0) * Math.PI / 180);

  // Standard Fabric transform composition:
  // [cos*scaleX,  sin*scaleX, -sin*scaleY, cos*scaleY, translateX, translateY]
  // with skew and flip
  const a = flipX * scaleX * (cos + skewY * sin);
  const b = flipX * scaleX * (sin - skewY * cos);
  const c = flipY * scaleY * (-sin + skewX * cos);
  const d = flipY * scaleY * (cos  + skewX * sin);
  const e = obj.left ?? 0;
  const f = obj.top  ?? 0;

  let own = [a, b, c, d, e, f];

  if (parentMtx) {
    own = multiplyMatrix(parentMtx, own);
  }
  return own;
}

/** Multiply two 2-D affine matrices represented as [a,b,c,d,e,f]. */
function multiplyMatrix([a1,b1,c1,d1,e1,f1], [a2,b2,c2,d2,e2,f2]) {
  return [
    a1*a2 + c1*b2,
    b1*a2 + d1*b2,
    a1*c2 + c1*d2,
    b1*c2 + d1*d2,
    a1*e2 + c1*f2 + e1,
    b1*e2 + d1*f2 + f1,
  ];
}

// ─── Shape renderers ──────────────────────────────────────────────────────────

function renderPath(page, obj, matrix, sx, sy, pdfH, opacity) {
  const pathData = obj.path;
  if (!pathData || !pathData.length) return;

  const svgPath = fabricPathToPdfSvg(pathData, matrix, sx, sy, pdfH);
  if (!svgPath) return;

  // Highlighter: stroke colour has an embedded "4D" alpha suffix.
  // We strip the suffix and apply a low opacity to the path itself.
  const rawStroke = obj.stroke ?? "#000000";
  const isHighlighter = typeof rawStroke === "string" && rawStroke.endsWith("4D");
  const strokeStr  = isHighlighter ? rawStroke.slice(0, -2) : rawStroke;
  const strokeParsed = parseColor(strokeStr, isHighlighter ? 0.3 : opacity);
  if (!strokeParsed) return;

  const opts = {
    borderColor: strokeParsed.color,
    borderWidth: (obj.strokeWidth ?? 2) * Math.max(sx, sy),
    borderLineCap: "Round",
    color: undefined,    // path is stroke-only (pen / highlighter / arrow)
    opacity: strokeParsed.opacity,
  };

  // If the object has a fill (unusual for pen paths), add it.
  const fillStr = obj.fill;
  if (fillStr && fillStr !== "transparent" && fillStr !== "none") {
    const fill = parseColor(fillStr, opacity);
    if (fill) opts.color = fill.color;
  }

  page.drawSvgPath(svgPath, opts);
}

function renderRect(page, obj, matrix, sx, sy, pdfH, opacity) {
  // Fabric Rect: originX/originY default to "left"/"top" for rects drawn in shapeTools
  // The matrix already encodes the translation; the bounding box is centred at (0,0)
  // in local space when originX="center", or at (-w/2, -h/2) when originX="left".
  // We compute the four corners in local space and find the PDF bounding box.
  const w = (obj.width  ?? 0) * (obj.scaleX ?? 1);
  const h = (obj.height ?? 0) * (obj.scaleY ?? 1);

  // For originX="left" / originY="top" (shapeTools default):
  const ox = obj.originX === "center" ? -w / 2 : 0;
  const oy = obj.originY === "center" ? -h / 2 : 0;

  // Four local corners
  const corners = [
    [ox,     oy    ],
    [ox + w, oy    ],
    [ox + w, oy + h],
    [ox,     oy + h],
  ].map(([x, y]) => {
    const [cx, cy] = applyMatrix(matrix, x, y);
    return toPdf(cx, cy, sx, sy, pdfH);
  });

  // If the rect has no rotation we can use drawRectangle directly.
  const angle = obj.angle ?? 0;
  if (Math.abs(angle) < 0.5) {
    const xs = corners.map(c => c[0]);
    const ys = corners.map(c => c[1]);
    const x  = Math.min(...xs);
    const y  = Math.min(...ys);
    const rw = Math.max(...xs) - x;
    const rh = Math.max(...ys) - y;

    const borderParsed = parseColor(obj.stroke ?? "transparent", opacity);
    const fillParsed   = parseColor(obj.fill   ?? "transparent", opacity);

    page.drawRectangle({
      x, y, width: rw, height: rh,
      borderWidth: borderParsed ? (obj.strokeWidth ?? 1) * Math.max(sx, sy) : 0,
      borderColor: borderParsed?.color,
      color:       fillParsed?.color,
      opacity:     Math.min(
        fillParsed?.opacity   ?? 1,
        borderParsed?.opacity ?? 1,
      ),
    });
  } else {
    // Rotated rect → emit as SVG path
    const [x0, y0] = corners[0];
    const svgPath  = `M ${corners[0].join(" ")} L ${corners[1].join(" ")} L ${corners[2].join(" ")} L ${corners[3].join(" ")} Z`;

    const borderParsed = parseColor(obj.stroke ?? "transparent", opacity);
    const fillParsed   = parseColor(obj.fill   ?? "transparent", opacity);
    page.drawSvgPath(svgPath, {
      x: 0, y: 0,
      borderWidth: borderParsed ? (obj.strokeWidth ?? 1) * Math.max(sx, sy) : 0,
      borderColor: borderParsed?.color,
      color:       fillParsed?.color,
      opacity:     Math.min(fillParsed?.opacity ?? 1, borderParsed?.opacity ?? 1),
    });
  }
}

function renderEllipse(page, obj, matrix, sx, sy, pdfH, opacity) {
  // Fabric Ellipse origin is "center"/"center".
  const [cx, cy] = applyMatrix(matrix, 0, 0);
  const [pdfCx, pdfCy] = toPdf(cx, cy, sx, sy, pdfH);

  const rx = (obj.rx ?? 0) * (obj.scaleX ?? 1) * sx;
  const ry = (obj.ry ?? 0) * (obj.scaleY ?? 1) * sy;

  const borderParsed = parseColor(obj.stroke ?? "transparent", opacity);
  const fillParsed   = parseColor(obj.fill   ?? "transparent", opacity);

  page.drawEllipse({
    x: pdfCx, y: pdfCy,
    xScale: rx, yScale: ry,
    borderWidth: borderParsed ? (obj.strokeWidth ?? 1) * Math.max(sx, sy) : 0,
    borderColor: borderParsed?.color,
    color:       fillParsed?.color,
    opacity:     Math.min(fillParsed?.opacity ?? 1, borderParsed?.opacity ?? 1),
    // Note: pdf-lib v1 drawEllipse does not support rotation; rotated ellipses
    // are rendered at 0° (extremely rare in practice for this annotation use case).
  });
}

function renderText(page, obj, matrix, sx, sy, pdfH, opacity, helvetica) {
  const text = (obj.text ?? "").trim();
  if (!text) return;

  // Position: Fabric text origin at top-left of the bounding box.
  // In Fabric JSON, left/top refer to the object's own origin.
  const [cx, cy] = applyMatrix(matrix, 0, 0);
  const [pdfX, pdfY] = toPdf(cx, cy, sx, sy, pdfH);

  const fontSize = (obj.fontSize ?? 16) * Math.min(sx, sy);
  const fillParsed = parseColor(obj.fill ?? "#000000", opacity);

  // Handle multi-line text: split on newlines and draw each line separately.
  const lines = text.split("\n");
  const lineHeight = fontSize * (obj.lineHeight ?? 1.16);

  lines.forEach((line, i) => {
    if (!line) return;
    try {
      page.drawText(line, {
        x: pdfX,
        // PDF y increases upward; each subsequent line is lower → subtract i * lineHeight
        y: pdfY - i * lineHeight,
        size:  fontSize,
        font:  helvetica,
        color: fillParsed?.color ?? rgb(0, 0, 0),
        opacity: fillParsed?.opacity ?? 1,
        rotate: obj.angle ? degrees(-(obj.angle)) : undefined,
      });
    } catch (_) { /* skip lines with unsupported characters */ }
  });
}

function renderLine(page, obj, matrix, sx, sy, pdfH, opacity) {
  // fabric.Line: x1,y1 → x2,y2 stored directly in the JSON.
  const x1 = obj.x1 ?? -((obj.width  ?? 0) / 2);
  const y1 = obj.y1 ?? -((obj.height ?? 0) / 2);
  const x2 = obj.x2 ??  ((obj.width  ?? 0) / 2);
  const y2 = obj.y2 ??  ((obj.height ?? 0) / 2);

  const [cx1, cy1] = applyMatrix(matrix, x1, y1);
  const [cx2, cy2] = applyMatrix(matrix, x2, y2);
  const [pdfX1, pdfY1] = toPdf(cx1, cy1, sx, sy, pdfH);
  const [pdfX2, pdfY2] = toPdf(cx2, cy2, sx, sy, pdfH);

  const strokeParsed = parseColor(obj.stroke ?? "#000000", opacity);
  if (!strokeParsed) return;

  page.drawLine({
    start: { x: pdfX1, y: pdfY1 },
    end:   { x: pdfX2, y: pdfY2 },
    thickness: (obj.strokeWidth ?? 1) * Math.max(sx, sy),
    color:   strokeParsed.color,
    opacity: strokeParsed.opacity,
  });
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Render the current Fabric canvas state onto the pristine PDF and return
 * the final PDF bytes.
 *
 * @param {Uint8Array} pristinePdfData   Original, un-annotated PDF bytes
 * @param {{ [pageNumber: number]: import("fabric").Canvas }} canvasByPage
 *   Live Fabric canvas instances keyed by 1-based page number
 * @returns {Promise<Uint8Array>}        Final PDF bytes ready for writing
 */
export async function savePdfWithAnnotations(pristinePdfData, canvasByPage) {
  // Normalise input to Uint8Array
  let safeData;
  if (pristinePdfData instanceof Uint8Array)      safeData = pristinePdfData;
  else if (pristinePdfData instanceof ArrayBuffer) safeData = new Uint8Array(pristinePdfData);
  else if (ArrayBuffer.isView(pristinePdfData))    safeData = new Uint8Array(pristinePdfData.buffer, pristinePdfData.byteOffset, pristinePdfData.byteLength);
  else if (Array.isArray(pristinePdfData))         safeData = new Uint8Array(pristinePdfData);
  else if (typeof pristinePdfData === "object")    safeData = new Uint8Array(Object.values(pristinePdfData));
  else throw new Error("Invalid PDF data type");

  const pdfDoc = await PDFDocument.load(safeData, { ignoreEncryption: true });
  const pages  = pdfDoc.getPages();

  // Embed Helvetica once for text rendering
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (let pageNum = 1; pageNum <= pages.length; pageNum++) {
    const fabricCanvas = canvasByPage[pageNum];
    if (!fabricCanvas) continue;

    // Serialise to plain JSON so we use consistent property names regardless
    // of whether we have a live Canvas or a deserialized snapshot.
    const serialised = fabricCanvas.toJSON();
    const objects    = serialised.objects ?? [];
    if (objects.length === 0) continue;

    const page        = pages[pageNum - 1];
    const { width: pdfW, height: pdfH } = page.getSize();
    const canvasW     = fabricCanvas.width  || pdfW;
    const canvasH     = fabricCanvas.height || pdfH;
    const sx          = pdfW / canvasW;
    const sy          = pdfH / canvasH;

    for (const obj of objects) {
      await renderObject(page, obj, sx, sy, pdfH, pdfDoc, helvetica, null);
    }
  }

  return await pdfDoc.save();
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

/**
 * Write PDF bytes to the file system via Tauri.
 * Returns true on success, false if no path was provided.
 *
 * @param {Uint8Array} pdfBytes
 * @param {string}     filePath
 */
export async function downloadPdf(pdfBytes, filePath) {
  if (!filePath) return false;
  await writeFile(filePath, pdfBytes);
  return true;
}
