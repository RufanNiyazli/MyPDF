/**
 * pdfSaver.jsx
 *
 * Hybrid vector PDF annotation renderer + self-contained embed/extract layer.
 *
 * Architecture:
 *   Every save starts from the PRISTINE original PDF bytes stored in memory.
 *   It burns all current Fabric canvas objects as real PDF vector operations,
 *   then embeds two hidden attachments into the saved file:
 *
 *     __mypdf_pristine__          – the original, un-annotated PDF bytes
 *     __mypdf_annotations__.json  – full Fabric JSON per page (for re-editing)
 *
 *   On reopen, both attachments are extracted so the user can continue
 *   editing annotations as first-class objects — not flat pixels.
 *
 *   Reset: write pristine bytes back to disk; no IDB / localStorage needed.
 */

import {
  PDFDocument, PDFDict, PDFName, PDFArray, PDFString,
  rgb, degrees, StandardFonts,
} from "pdf-lib";
import { writeFile } from "@tauri-apps/plugin-fs";

// ─── Attachment names ─────────────────────────────────────────────────────────

const PRISTINE_NAME     = "__mypdf_pristine__";
const ANNOTATIONS_NAME  = "__mypdf_annotations__.json";

// ─── Low-level embed helper ───────────────────────────────────────────────────

/**
 * Add an uncompressed embedded-file attachment to an already-loaded PDFDocument.
 * We deliberately skip FlateDecode so extraction needs no decompressor.
 */
function addEmbeddedFile(pdfDoc, filename, fileBytes, mimeType) {
  const ctx = pdfDoc.context;

  // 1. Embedded-file stream (no filter = uncompressed)
  const efStream = ctx.stream(fileBytes, {
    Type:    "EmbeddedFile",
    Subtype: mimeType,
    Length:  fileBytes.length,
  });
  const efRef = ctx.register(efStream);

  // 2. FileSpec dictionary
  const fsDict = ctx.obj({
    Type: "Filespec",
    F:    PDFString.of(filename),
    UF:   PDFString.of(filename),
    EF:   ctx.obj({ F: efRef }),
    Desc: PDFString.of("Embedded by mypdf"),
  });
  const fsRef = ctx.register(fsDict);

  // 3. Wire into catalog → Names → EmbeddedFiles → Names[]
  const catalog = pdfDoc.catalog;

  let namesNode = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  if (!namesNode) {
    const ref = ctx.register(ctx.obj({}));
    catalog.set(PDFName.of("Names"), ref);
    namesNode = ctx.lookup(ref, PDFDict);
  }

  let efNode = namesNode.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  if (!efNode) {
    const ref = ctx.register(ctx.obj({ Names: [] }));
    namesNode.set(PDFName.of("EmbeddedFiles"), ref);
    efNode = ctx.lookup(ref, PDFDict);
  }

  let namesArr = efNode.lookupMaybe(PDFName.of("Names"), PDFArray);
  if (!namesArr) {
    const ref = ctx.register(ctx.obj([]));
    efNode.set(PDFName.of("Names"), ref);
    namesArr = ctx.lookup(ref, PDFArray);
  }

  namesArr.push(PDFString.of(filename), fsRef);
}

// ─── Low-level extract helper ─────────────────────────────────────────────────

/**
 * Decompress a deflate-encoded buffer using the browser's built-in
 * DecompressionStream. Falls back to trying the zlib variant.
 */
async function inflateDeflate(data) {
  for (const fmt of ["deflate-raw", "deflate"]) {
    try {
      const ds     = new DecompressionStream(fmt);
      const writer = ds.writable.getWriter();
      writer.write(data);
      writer.close();
      const buf = await new Response(ds.readable).arrayBuffer();
      return new Uint8Array(buf);
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Extract a named embedded file from a PDF byte array.
 * Returns Uint8Array on success, null if not found.
 */
export async function extractEmbeddedFile(pdfBytes, targetName) {
  try {
    const pdfDoc  = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const ctx     = pdfDoc.context;
    const catalog = pdfDoc.catalog;

    const namesNode = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
    if (!namesNode) return null;

    const efNode = namesNode.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
    if (!efNode) return null;

    const namesArr = efNode.lookupMaybe(PDFName.of("Names"), PDFArray);
    if (!namesArr) return null;

    for (let i = 0; i + 1 < namesArr.size(); i += 2) {
      const keyObj = namesArr.lookup(i);
      const keyStr = keyObj instanceof PDFString
        ? keyObj.decodeText()
        : (keyObj?.decodeText?.() ?? "");

      if (keyStr !== targetName) continue;

      // Resolve FileSpec → EF → F stream
      const fsObj   = namesArr.get(i + 1);
      const fsDict  = ctx.lookup(fsObj, PDFDict);
      if (!fsDict) continue;

      const efDict  = fsDict.lookupMaybe(PDFName.of("EF"), PDFDict);
      if (!efDict) continue;

      const streamRef = efDict.get(PDFName.of("F"));
      if (!streamRef) continue;

      const stream = ctx.lookup(streamRef);
      if (!stream || !stream.contents) continue;

      // Check for a compression filter
      const filter = stream.dict?.lookupMaybe?.(PDFName.of("Filter"));
      if (!filter) {
        return stream.contents instanceof Uint8Array ? stream.contents : null;
      }

      // FlateDecode — decompress
      return await inflateDeflate(stream.contents);
    }

    return null;
  } catch (e) {
    console.warn("[pdfSaver] extractEmbeddedFile error:", e);
    return null;
  }
}

// ─── Public extract helpers ───────────────────────────────────────────────────

/** Extract the pristine (original, un-annotated) PDF bytes. */
export async function extractPristineSnapshot(pdfBytes) {
  return extractEmbeddedFile(pdfBytes, PRISTINE_NAME);
}

/**
 * Extract the Fabric annotations JSON.
 * Returns { [pageNumber: string]: fabricJsonString } or null.
 */
export async function extractAnnotationsJson(pdfBytes) {
  const raw = await extractEmbeddedFile(pdfBytes, ANNOTATIONS_NAME);
  if (!raw) return null;
  try {
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
}

// ─── Color helpers ────────────────────────────────────────────────────────────

const NAMED_COLORS = {
  black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 0.5, 0],
  blue: [0, 0, 1], yellow: [1, 1, 0], orange: [1, 0.65, 0],
  purple: [0.5, 0, 0.5], cyan: [0, 1, 1], magenta: [1, 0, 1],
  gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5], transparent: null,
};

function parseColor(str, baseOpacity = 1) {
  if (!str || str === "transparent" || str === "none") return null;
  const lc = str.toLowerCase().trim();
  if (NAMED_COLORS[lc]) {
    const [r, g, b] = NAMED_COLORS[lc];
    return { color: rgb(r, g, b), opacity: baseOpacity };
  }
  if (lc === "transparent" || lc === "none") return null;
  const rgba = lc.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (rgba) {
    const op = rgba[4] !== undefined ? parseFloat(rgba[4]) * baseOpacity : baseOpacity;
    return { color: rgb(+rgba[1] / 255, +rgba[2] / 255, +rgba[3] / 255), opacity: op };
  }
  let h = lc.replace(/^#/, "");
  if (h.length === 3)  h = h.split("").map(c => c + c).join("");
  if (h.length === 6 || h.length === 8) {
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const a = h.length === 8 ? (parseInt(h.slice(6, 8), 16) / 255) * baseOpacity : baseOpacity;
    return { color: rgb(r, g, b), opacity: a };
  }
  return { color: rgb(0, 0, 0), opacity: baseOpacity };
}

// ─── Coordinate helpers ───────────────────────────────────────────────────────

function applyMatrix(matrix, x, y) {
  const [a, b, c, d, e, f] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

function toPdf(canvasX, canvasY, sx, sy, pdfH) {
  return [canvasX * sx, pdfH - canvasY * sy];
}

// ─── SVG path builder ─────────────────────────────────────────────────────────

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
      case "H": { const [px, py] = xf(cmd[1], 0);      parts.push(`L ${px} ${py}`); break; }
      case "V": { const [px, py] = xf(0, cmd[1]);      parts.push(`L ${px} ${py}`); break; }
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

// ─── Matrix helpers ───────────────────────────────────────────────────────────

function computeMatrix(obj, parentMtx) {
  const angle  = ((obj.angle ?? 0) * Math.PI) / 180;
  const scaleX = obj.scaleX ?? 1;
  const scaleY = obj.scaleY ?? 1;
  const flipX  = obj.flipX  ? -1 : 1;
  const flipY  = obj.flipY  ? -1 : 1;
  const cos    = Math.cos(angle);
  const sin    = Math.sin(angle);
  const skewX  = Math.tan((obj.skewX ?? 0) * Math.PI / 180);
  const skewY  = Math.tan((obj.skewY ?? 0) * Math.PI / 180);

  const a = flipX * scaleX * (cos + skewY * sin);
  const b = flipX * scaleX * (sin - skewY * cos);
  const c = flipY * scaleY * (-sin + skewX * cos);
  const d = flipY * scaleY * (cos  + skewX * sin);
  const e = obj.left ?? 0;
  const f = obj.top  ?? 0;

  let own = [a, b, c, d, e, f];
  if (parentMtx) own = multiplyMatrix(parentMtx, own);
  return own;
}

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

// ─── Per-object renderer ──────────────────────────────────────────────────────

async function renderObject(page, obj, sx, sy, pdfH, pdfDoc, helvetica, parentMatrix) {
  const matrix        = computeMatrix(obj, parentMatrix);
  const globalOpacity = obj.opacity ?? 1;
  const type          = (obj.type || "").toLowerCase();

  try {
    if      (type === "path")                                 renderPath   (page, obj, matrix, sx, sy, pdfH, globalOpacity);
    else if (type === "rect")                                 renderRect   (page, obj, matrix, sx, sy, pdfH, globalOpacity);
    else if (type === "ellipse")                              renderEllipse(page, obj, matrix, sx, sy, pdfH, globalOpacity);
    else if (type === "textbox" || type === "itext" || type === "text")
                                                              renderText   (page, obj, matrix, sx, sy, pdfH, globalOpacity, helvetica);
    else if (type === "line")                                 renderLine   (page, obj, matrix, sx, sy, pdfH, globalOpacity);
    else if (type === "group") {
      const children = obj.objects ?? obj._objects ?? [];
      for (const child of children)
        await renderObject(page, child, sx, sy, pdfH, pdfDoc, helvetica, matrix);
    }
  } catch (err) {
    console.warn(`[pdfSaver] Could not render "${type}":`, err);
  }
}

// ─── Shape renderers ──────────────────────────────────────────────────────────

function renderPath(page, obj, matrix, sx, sy, pdfH, opacity) {
  if (!obj.path?.length) return;
  const svgPath = fabricPathToPdfSvg(obj.path, matrix, sx, sy, pdfH);
  if (!svgPath) return;

  const rawStroke    = obj.stroke ?? "#000000";
  const isHighlight  = typeof rawStroke === "string" && rawStroke.endsWith("4D");
  const strokeStr    = isHighlight ? rawStroke.slice(0, -2) : rawStroke;
  const strokeParsed = parseColor(strokeStr, isHighlight ? 0.3 : opacity);
  if (!strokeParsed) return;

  const opts = {
    borderColor: strokeParsed.color,
    borderWidth: (obj.strokeWidth ?? 2) * Math.max(sx, sy),
    borderLineCap: "Round",
    color:   undefined,
    opacity: strokeParsed.opacity,
  };
  const fillStr = obj.fill;
  if (fillStr && fillStr !== "transparent" && fillStr !== "none") {
    const fill = parseColor(fillStr, opacity);
    if (fill) opts.color = fill.color;
  }
  page.drawSvgPath(svgPath, opts);
}

function renderRect(page, obj, matrix, sx, sy, pdfH, opacity) {
  const w  = (obj.width  ?? 0) * (obj.scaleX ?? 1);
  const h  = (obj.height ?? 0) * (obj.scaleY ?? 1);
  const ox = obj.originX === "center" ? -w / 2 : 0;
  const oy = obj.originY === "center" ? -h / 2 : 0;

  const corners = [
    [ox,     oy    ],
    [ox + w, oy    ],
    [ox + w, oy + h],
    [ox,     oy + h],
  ].map(([x, y]) => {
    const [cx, cy] = applyMatrix(matrix, x, y);
    return toPdf(cx, cy, sx, sy, pdfH);
  });

  const angle = obj.angle ?? 0;
  if (Math.abs(angle) < 0.5) {
    const xs = corners.map(c => c[0]);
    const ys = corners.map(c => c[1]);
    const x  = Math.min(...xs), y  = Math.min(...ys);
    const rw = Math.max(...xs) - x, rh = Math.max(...ys) - y;
    const bp = parseColor(obj.stroke ?? "transparent", opacity);
    const fp = parseColor(obj.fill   ?? "transparent", opacity);
    page.drawRectangle({
      x, y, width: rw, height: rh,
      borderWidth: bp ? (obj.strokeWidth ?? 1) * Math.max(sx, sy) : 0,
      borderColor: bp?.color,
      color:       fp?.color,
      opacity:     Math.min(fp?.opacity ?? 1, bp?.opacity ?? 1),
    });
  } else {
    const svgPath  = `M ${corners[0].join(" ")} L ${corners[1].join(" ")} L ${corners[2].join(" ")} L ${corners[3].join(" ")} Z`;
    const bp = parseColor(obj.stroke ?? "transparent", opacity);
    const fp = parseColor(obj.fill   ?? "transparent", opacity);
    page.drawSvgPath(svgPath, {
      x: 0, y: 0,
      borderWidth: bp ? (obj.strokeWidth ?? 1) * Math.max(sx, sy) : 0,
      borderColor: bp?.color,
      color:       fp?.color,
      opacity:     Math.min(fp?.opacity ?? 1, bp?.opacity ?? 1),
    });
  }
}

function renderEllipse(page, obj, matrix, sx, sy, pdfH, opacity) {
  const [cx, cy]       = applyMatrix(matrix, 0, 0);
  const [pdfCx, pdfCy] = toPdf(cx, cy, sx, sy, pdfH);
  const rx = (obj.rx ?? 0) * (obj.scaleX ?? 1) * sx;
  const ry = (obj.ry ?? 0) * (obj.scaleY ?? 1) * sy;
  const bp = parseColor(obj.stroke ?? "transparent", opacity);
  const fp = parseColor(obj.fill   ?? "transparent", opacity);
  page.drawEllipse({
    x: pdfCx, y: pdfCy, xScale: rx, yScale: ry,
    borderWidth: bp ? (obj.strokeWidth ?? 1) * Math.max(sx, sy) : 0,
    borderColor: bp?.color,
    color:       fp?.color,
    opacity:     Math.min(fp?.opacity ?? 1, bp?.opacity ?? 1),
  });
}

function renderText(page, obj, matrix, sx, sy, pdfH, opacity, helvetica) {
  const text = (obj.text ?? "").trim();
  if (!text) return;
  const [cx, cy]    = applyMatrix(matrix, 0, 0);
  const [pdfX, pdfY] = toPdf(cx, cy, sx, sy, pdfH);
  const fontSize    = (obj.fontSize ?? 16) * Math.min(sx, sy);
  const fp          = parseColor(obj.fill ?? "#000000", opacity);
  const lines       = text.split("\n");
  const lineHeight  = fontSize * (obj.lineHeight ?? 1.16);
  lines.forEach((line, i) => {
    if (!line) return;
    try {
      page.drawText(line, {
        x: pdfX, y: pdfY - i * lineHeight,
        size:  fontSize, font: helvetica,
        color: fp?.color ?? rgb(0, 0, 0),
        opacity: fp?.opacity ?? 1,
        rotate: obj.angle ? degrees(-(obj.angle)) : undefined,
      });
    } catch (_) { /* skip unsupported chars */ }
  });
}

function renderLine(page, obj, matrix, sx, sy, pdfH, opacity) {
  const x1 = obj.x1 ?? -((obj.width  ?? 0) / 2);
  const y1 = obj.y1 ?? -((obj.height ?? 0) / 2);
  const x2 = obj.x2 ??  ((obj.width  ?? 0) / 2);
  const y2 = obj.y2 ??  ((obj.height ?? 0) / 2);
  const [cx1, cy1] = applyMatrix(matrix, x1, y1);
  const [cx2, cy2] = applyMatrix(matrix, x2, y2);
  const [pdfX1, pdfY1] = toPdf(cx1, cy1, sx, sy, pdfH);
  const [pdfX2, pdfY2] = toPdf(cx2, cy2, sx, sy, pdfH);
  const sp = parseColor(obj.stroke ?? "#000000", opacity);
  if (!sp) return;
  page.drawLine({
    start: { x: pdfX1, y: pdfY1 },
    end:   { x: pdfX2, y: pdfY2 },
    thickness: (obj.strokeWidth ?? 1) * Math.max(sx, sy),
    color: sp.color, opacity: sp.opacity,
  });
}

// ─── Public: save ─────────────────────────────────────────────────────────────

/**
 * Burn annotations onto the pristine PDF, embed pristine + annotation JSON,
 * and return the final PDF bytes.
 *
 * @param {Uint8Array} pristinePdfData   Original un-annotated PDF bytes
 * @param {{ [pageNum]: FabricCanvas }}  canvasByPage  Live Fabric canvases
 * @param {Uint8Array} [pristineBytes]   Same as pristinePdfData; passed
 *   explicitly so callers are intentional about what gets embedded.
 */
export async function savePdfWithAnnotations(pristinePdfData, canvasByPage, pristineBytes) {
  // Normalise input to Uint8Array
  let safeData;
  if      (pristinePdfData instanceof Uint8Array)      safeData = pristinePdfData;
  else if (pristinePdfData instanceof ArrayBuffer)     safeData = new Uint8Array(pristinePdfData);
  else if (ArrayBuffer.isView(pristinePdfData))        safeData = new Uint8Array(pristinePdfData.buffer, pristinePdfData.byteOffset, pristinePdfData.byteLength);
  else if (Array.isArray(pristinePdfData))             safeData = new Uint8Array(pristinePdfData);
  else if (typeof pristinePdfData === "object")        safeData = new Uint8Array(Object.values(pristinePdfData));
  else throw new Error("Invalid PDF data type");

  const pdfDoc     = await PDFDocument.load(safeData, { ignoreEncryption: true });
  const pages      = pdfDoc.getPages();
  const helvetica  = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Collect page states and burn annotations
  const pageStates = {};

  for (let pageNum = 1; pageNum <= pages.length; pageNum++) {
    const fabricCanvas = canvasByPage[pageNum];
    if (!fabricCanvas) continue;

    const serialised = fabricCanvas.toJSON();
    const objects    = serialised.objects ?? [];

    if (objects.length > 0) {
      // Store Fabric JSON for embedding
      pageStates[pageNum] = JSON.stringify(serialised);

      // Burn onto PDF
      const page              = pages[pageNum - 1];
      const { width: pdfW, height: pdfH } = page.getSize();
      const canvasW           = fabricCanvas.width  || pdfW;
      const canvasH           = fabricCanvas.height || pdfH;
      const sx                = pdfW / canvasW;
      const sy                = pdfH / canvasH;

      for (const obj of objects) {
        await renderObject(page, obj, sx, sy, pdfH, pdfDoc, helvetica, null);
      }
    }
  }

  // Embed attachments when there are annotations
  const hasAnnotations = Object.keys(pageStates).length > 0;
  if (hasAnnotations && pristineBytes) {
    // Normalise pristineBytes
    let safePristine;
    if      (pristineBytes instanceof Uint8Array)      safePristine = pristineBytes;
    else if (pristineBytes instanceof ArrayBuffer)     safePristine = new Uint8Array(pristineBytes);
    else if (ArrayBuffer.isView(pristineBytes))        safePristine = new Uint8Array(pristineBytes.buffer, pristineBytes.byteOffset, pristineBytes.byteLength);
    else safePristine = pristineBytes;

    addEmbeddedFile(pdfDoc, PRISTINE_NAME,    safePristine, "application/pdf");
    addEmbeddedFile(pdfDoc, ANNOTATIONS_NAME,
      new TextEncoder().encode(JSON.stringify(pageStates)),
      "application/json"
    );
  }

  return pdfDoc.save();
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

/**
 * Write PDF bytes to the filesystem via Tauri.
 */
export async function downloadPdf(pdfBytes, filePath) {
  if (!filePath) return false;
  await writeFile(filePath, pdfBytes);
  return true;
}
