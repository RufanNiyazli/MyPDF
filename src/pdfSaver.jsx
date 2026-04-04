

import { PDFDocument, rgb, degrees, StandardFonts } from "pdf-lib";
import { writeFile } from "@tauri-apps/plugin-fs";


const SECTION_MARKER   = "%mypdf-incremental-v1";
const PRISTINE_NAME    = "__mypdf_pristine__";
const ANNOTATIONS_NAME = "__mypdf_annotations__.json";

const enc = new TextEncoder();
const dec = new TextDecoder("latin1"); 


async function deflateBytes(bytes) {
  try {
    const cs = new CompressionStream("deflate-raw");
    const w  = cs.writable.getWriter();
    w.write(bytes); w.close();
    return { data: new Uint8Array(await new Response(cs.readable).arrayBuffer()), compressed: true };
  } catch {
    return { data: bytes, compressed: false };
  }
}

async function inflateBytes(bytes) {
  for (const fmt of ["deflate-raw", "deflate"]) {
    try {
      const ds = new DecompressionStream(fmt);
      const w  = ds.writable.getWriter();
      w.write(bytes); w.close();
      return new Uint8Array(await new Response(ds.readable).arrayBuffer());
    } catch { /* try next */ }
  }
  return bytes;
}

function concat(...chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out   = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function pdfLit(str) {
  return "(" + str
    .replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)")
    .replace(/\r/g,"\\r").replace(/\n/g,"\\n") + ")";
}

async function appendIncrementalEmbeddedFiles(existingBytes, files) {
  const existingText = dec.decode(existingBytes);

  let highestObj = 0;
  for (const m of existingText.matchAll(/^(\d+)\s+0\s+obj/gm))
    highestObj = Math.max(highestObj, parseInt(m[1], 10));

  let prevStartxref = 0;
  for (const m of existingText.matchAll(/startxref\s+(\d+)/g))
    prevStartxref = parseInt(m[1], 10);

  let nextId = highestObj + 1;
  const alloc = () => nextId++;

  const efIds = files.map(() => alloc()); 
  const fsIds = files.map(() => alloc()); 
  const efNamesId = alloc();              
  const namesId   = alloc();              

  const baseOffset = existingBytes.length;
  const parts      = [];
  let   pos        = 0;

  const push = (chunk) => { parts.push(chunk); pos += chunk.length; };
  push(enc.encode(`\n${SECTION_MARKER}\n`));

  const xrefEntries = []; 
  const addObj = async (id, dictEntries, streamBytes = null) => {
    xrefEntries.push({ id, offset: baseOffset + pos });

    let header = `${id} 0 obj\n<<\n`;
    for (const line of dictEntries) header += `  ${line}\n`;

    if (streamBytes !== null) {
      const { data, compressed } = await deflateBytes(streamBytes);
      header += `  /Length ${data.length}\n`;
      if (compressed) header += `  /Filter /FlateDecode\n`;
      header += `>>\nstream\n`;
      push(concat(enc.encode(header), data, enc.encode(`\nendstream\nendobj\n`)));
    } else {
      header += `>>\nendobj\n`;
      push(enc.encode(header));
    }
  };

  for (let i = 0; i < files.length; i++) {
    const { bytes, mimeType } = files[i];
    await addObj(efIds[i], [
      `/Type /EmbeddedFile`,
      `/Subtype /${mimeType.replace("/","#2F")}`,
      `/Params << /Size ${bytes.length} >>`,
    ], bytes);
  }

  for (let i = 0; i < files.length; i++) {
    const lit = pdfLit(files[i].name);
    await addObj(fsIds[i], [
      `/Type /Filespec`,
      `/F ${lit}`,
      `/UF ${lit}`,
      `/EF << /F ${efIds[i]} 0 R >>`,
      `/Desc (Embedded by mypdf)`,
    ]);
  }

  const namesArr = files.map((f,i) => `${pdfLit(f.name)} ${fsIds[i]} 0 R`).join("  ");
  await addObj(efNamesId, [`/Names [ ${namesArr} ]`]);

  await addObj(namesId, [`/EmbeddedFiles ${efNamesId} 0 R`]);

  xrefEntries.sort((a,b) => a.id - b.id);
  let xrefStr = "xref\n";
  let i = 0;
  while (i < xrefEntries.length) {
    let j = i;
    while (j+1 < xrefEntries.length && xrefEntries[j+1].id === xrefEntries[j].id+1) j++;
    xrefStr += `${xrefEntries[i].id} ${j-i+1}\n`;
    for (let k=i; k<=j; k++)
      xrefStr += `${String(xrefEntries[k].offset).padStart(10,"0")} 00000 n \r\n`;
    i = j+1;
  }

  const startxrefAbs = baseOffset + pos + xrefStr.length;

  const trailer =
    `trailer\n<<\n` +
    `  /Size ${nextId}\n` +
    `  /mypdfNames ${namesId} 0 R\n` +
    (prevStartxref ? `  /Prev ${prevStartxref}\n` : "") +
    `>>\nstartxref\n${startxrefAbs}\n%%EOF\n`;

  push(enc.encode(xrefStr + trailer));

  return concat(existingBytes, ...parts);
}

export async function extractEmbeddedFile(pdfBytes, targetName) {
  try {
    // Use latin1 so binary bytes survive the decode→search→slice round-trip
    const text     = dec.decode(pdfBytes);
    const markerIdx = text.lastIndexOf(SECTION_MARKER);
    if (markerIdx === -1) return null;

    const section = text.slice(markerIdx);

    const objects = {};
    for (const m of section.matchAll(/(\d+)\s+0\s+obj\s*([\s\S]*?)\s*endobj/g)) {
      const id   = parseInt(m[1], 10);
      const body = m[2];
      const sM   = body.match(/<<([\s\S]*?)>>\s*stream\n([\s\S]*?)\nendstream/);
      if (sM) {
        objects[id] = { dictText: sM[1], hasStream: true };
      } else {
        const dM = body.match(/<<([\s\S]*?)>>/);
        objects[id] = { dictText: dM ? dM[1] : body, hasStream: false };
      }
    }

    let efStreamId = null;
    for (const [, obj] of Object.entries(objects)) {
      const fM = obj.dictText.match(/\/F\s*\(([^)]*)\)/);
      if (!fM) continue;
      const name = fM[1]
        .replace(/\\n/g,"\n").replace(/\\r/g,"\r")
        .replace(/\\\\/g,"\\").replace(/\\\(/g,"(").replace(/\\\)/g,")");
      if (name !== targetName) continue;
      const efM = obj.dictText.match(/\/EF\s*<<\s*\/F\s*(\d+)\s+0\s+R/);
      if (!efM) return null;
      efStreamId = parseInt(efM[1], 10);
      break;
    }
    if (efStreamId === null) return null;

    const streamObj = objects[efStreamId];
    if (!streamObj?.hasStream) return null;

    // Extract stream bytes at the BYTE level using /Length
    const lengthM = streamObj.dictText.match(/\/Length\s+(\d+)/);
    if (!lengthM) return null;
    const length = parseInt(lengthM[1], 10);

 
    const objLabel   = `${efStreamId} 0 obj`;
    const objRelIdx  = section.indexOf(objLabel);
    if (objRelIdx === -1) return null;

    const objAbsIdx  = markerIdx + objRelIdx;
    const windowLen  = 512 + streamObj.dictText.length;
    const windowText = text.slice(objAbsIdx, objAbsIdx + windowLen);
    const streamRel  = windowText.indexOf("stream\n");
    if (streamRel === -1) return null;

    const streamStart = objAbsIdx + streamRel + 7; 
    const rawBytes    = pdfBytes.slice(streamStart, streamStart + length);

    if (/\/Filter\s*\/FlateDecode/.test(streamObj.dictText))
      return await inflateBytes(rawBytes);
    return rawBytes;
  } catch (e) {
    console.warn("[pdfSaver] extractEmbeddedFile error:", e);
    return null;
  }
}

export async function extractPristineSnapshot(pdfBytes) {
  return extractEmbeddedFile(pdfBytes, PRISTINE_NAME);
}

export async function extractAnnotationsJson(pdfBytes) {
  const raw = await extractEmbeddedFile(pdfBytes, ANNOTATIONS_NAME);
  if (!raw) return null;
  try { return JSON.parse(new TextDecoder().decode(raw)); } catch { return null; }
}


const NAMED_COLORS = {
  black:[0,0,0],white:[1,1,1],red:[1,0,0],green:[0,.502,0],
  blue:[0,0,1],yellow:[1,1,0],orange:[1,.647,0],purple:[.502,0,.502],
  cyan:[0,1,1],magenta:[1,0,1],gray:[.502,.502,.502],grey:[.502,.502,.502],
};

function parseColor(str, baseOpacity=1) {
  if (!str||str==="transparent"||str==="none") return null;
  const lc=str.toLowerCase().trim();
  if (NAMED_COLORS[lc]) { const [r,g,b]=NAMED_COLORS[lc]; return {color:rgb(r,g,b),opacity:baseOpacity}; }
  const rgba=lc.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (rgba) { const op=rgba[4]!==undefined?parseFloat(rgba[4])*baseOpacity:baseOpacity; return {color:rgb(+rgba[1]/255,+rgba[2]/255,+rgba[3]/255),opacity:op}; }
  let h=lc.replace(/^#/,""); if(h.length===3) h=h.split("").map(c=>c+c).join("");
  if (h.length===6||h.length===8) {
    const r=parseInt(h.slice(0,2),16)/255,g=parseInt(h.slice(2,4),16)/255,b=parseInt(h.slice(4,6),16)/255;
    const a=h.length===8?(parseInt(h.slice(6,8),16)/255)*baseOpacity:baseOpacity;
    return {color:rgb(r,g,b),opacity:a};
  }
  return {color:rgb(0,0,0),opacity:baseOpacity};
}

function applyMatrix([a,b,c,d,e,f],x,y){return[a*x+c*y+e,b*x+d*y+f];}
function toPdf(cx,cy,sx,sy,pdfH){return[cx*sx,pdfH-cy*sy];}

function fabricPathToPdfSvg(pathArray,matrix,sx,sy,pdfH){
  const xf=(x,y)=>{const[cx,cy]=applyMatrix(matrix,x,y);return toPdf(cx,cy,sx,sy,pdfH);};
  const p=[];
  for(const cmd of pathArray){
    switch(cmd[0].toUpperCase()){
      case"M":{const[px,py]=xf(cmd[1],cmd[2]);p.push(`M ${px} ${py}`);break;}
      case"L":{const[px,py]=xf(cmd[1],cmd[2]);p.push(`L ${px} ${py}`);break;}
      case"H":{const[px,py]=xf(cmd[1],0);p.push(`L ${px} ${py}`);break;}
      case"V":{const[px,py]=xf(0,cmd[1]);p.push(`L ${px} ${py}`);break;}
      case"Q":{const[cx,cy]=xf(cmd[1],cmd[2]);const[px,py]=xf(cmd[3],cmd[4]);p.push(`Q ${cx} ${cy} ${px} ${py}`);break;}
      case"C":{const[c1x,c1y]=xf(cmd[1],cmd[2]);const[c2x,c2y]=xf(cmd[3],cmd[4]);const[px,py]=xf(cmd[5],cmd[6]);p.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${px} ${py}`);break;}
      case"Z":p.push("Z");break;
    }
  }
  return p.join(" ");
}

function computeMatrix(obj,parentMtx){
  const angle=(obj.angle??0)*Math.PI/180;
  const fx=obj.flipX?-1:1,fy=obj.flipY?-1:1,sx=obj.scaleX??1,sy=obj.scaleY??1;
  const cos=Math.cos(angle),sin=Math.sin(angle);
  const skx=Math.tan(((obj.skewX??0)*Math.PI)/180),sky=Math.tan(((obj.skewY??0)*Math.PI)/180);
  const own=[fx*sx*(cos+sky*sin),fx*sx*(sin-sky*cos),fy*sy*(-sin+skx*cos),fy*sy*(cos+skx*sin),obj.left??0,obj.top??0];
  if(!parentMtx)return own;
  const[a1,b1,c1,d1,e1,f1]=parentMtx,[a2,b2,c2,d2,e2,f2]=own;
  return[a1*a2+c1*b2,b1*a2+d1*b2,a1*c2+c1*d2,b1*c2+d1*d2,a1*e2+c1*f2+e1,b1*e2+d1*f2+f1];
}

async function renderObject(page,obj,sx,sy,pdfH,pdfDoc,font,parentMtx){
  const matrix=computeMatrix(obj,parentMtx),opacity=obj.opacity??1,type=(obj.type||"").toLowerCase();
  try{
    if(type==="path") renderPath(page,obj,matrix,sx,sy,pdfH,opacity);
    else if(type==="rect") renderRect(page,obj,matrix,sx,sy,pdfH,opacity);
    else if(type==="ellipse") renderEllipse(page,obj,matrix,sx,sy,pdfH,opacity);
    else if(type==="textbox"||type==="itext"||type==="text") renderText(page,obj,matrix,sx,sy,pdfH,opacity,font);
    else if(type==="line") renderLine(page,obj,matrix,sx,sy,pdfH,opacity);
    else if(type==="group") for(const child of(obj.objects??obj._objects??[])) await renderObject(page,child,sx,sy,pdfH,pdfDoc,font,matrix);
  }catch(e){console.warn(`[pdfSaver] render "${type}":`,e);}
}

function renderPath(page,obj,matrix,sx,sy,pdfH,opacity){
  if(!obj.path?.length)return;
  const svg=fabricPathToPdfSvg(obj.path,matrix,sx,sy,pdfH);if(!svg)return;
  const raw=obj.stroke??"#000000",isHL=typeof raw==="string"&&raw.endsWith("4D");
  const sp=parseColor(isHL?raw.slice(0,-2):raw,isHL?0.3:opacity);if(!sp)return;
  const opts={borderColor:sp.color,borderWidth:(obj.strokeWidth??2)*Math.max(sx,sy),borderLineCap:"Round",opacity:sp.opacity};
  if(obj.fill&&obj.fill!=="transparent"&&obj.fill!=="none"){const fp=parseColor(obj.fill,opacity);if(fp)opts.color=fp.color;}
  page.drawSvgPath(svg,opts);
}

function renderRect(page,obj,matrix,sx,sy,pdfH,opacity){
  const w=(obj.width??0)*(obj.scaleX??1),h=(obj.height??0)*(obj.scaleY??1);
  const ox=obj.originX==="center"?-w/2:0,oy=obj.originY==="center"?-h/2:0;
  const corners=[[ox,oy],[ox+w,oy],[ox+w,oy+h],[ox,oy+h]].map(([x,y])=>{const[cx,cy]=applyMatrix(matrix,x,y);return toPdf(cx,cy,sx,sy,pdfH);});
  const bp=parseColor(obj.stroke??"transparent",opacity),fp=parseColor(obj.fill??"transparent",opacity);
  const bw=bp?(obj.strokeWidth??1)*Math.max(sx,sy):0,op=Math.min(fp?.opacity??1,bp?.opacity??1);
  if(Math.abs(obj.angle??0)<0.5){
    const xs=corners.map(c=>c[0]),ys=corners.map(c=>c[1]);
    page.drawRectangle({x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys),borderWidth:bw,borderColor:bp?.color,color:fp?.color,opacity:op});
  }else{
    page.drawSvgPath(`M ${corners[0].join(" ")} L ${corners[1].join(" ")} L ${corners[2].join(" ")} L ${corners[3].join(" ")} Z`,{x:0,y:0,borderWidth:bw,borderColor:bp?.color,color:fp?.color,opacity:op});
  }
}

function renderEllipse(page,obj,matrix,sx,sy,pdfH,opacity){
  const[cx,cy]=applyMatrix(matrix,0,0),[pcx,pcy]=toPdf(cx,cy,sx,sy,pdfH);
  const rx=(obj.rx??0)*(obj.scaleX??1)*sx,ry=(obj.ry??0)*(obj.scaleY??1)*sy;
  const bp=parseColor(obj.stroke??"transparent",opacity),fp=parseColor(obj.fill??"transparent",opacity);
  page.drawEllipse({x:pcx,y:pcy,xScale:rx,yScale:ry,borderWidth:bp?(obj.strokeWidth??1)*Math.max(sx,sy):0,borderColor:bp?.color,color:fp?.color,opacity:Math.min(fp?.opacity??1,bp?.opacity??1)});
}

function renderText(page,obj,matrix,sx,sy,pdfH,opacity,font){
  const text=(obj.text??"").trim();if(!text)return;
  const[cx,cy]=applyMatrix(matrix,0,0),[px,py]=toPdf(cx,cy,sx,sy,pdfH);
  const size=(obj.fontSize??16)*Math.min(sx,sy),fp=parseColor(obj.fill??"#000000",opacity),lh=size*(obj.lineHeight??1.16);
  text.split("\n").forEach((line,i)=>{
    if(!line)return;
    try{page.drawText(line,{x:px,y:py-i*lh,size,font,color:fp?.color??rgb(0,0,0),opacity:fp?.opacity??1,rotate:obj.angle?degrees(-obj.angle):undefined});}catch(_){}
  });
}

function renderLine(page,obj,matrix,sx,sy,pdfH,opacity){
  const x1=obj.x1??-((obj.width??0)/2),y1=obj.y1??-((obj.height??0)/2);
  const x2=obj.x2??((obj.width??0)/2),y2=obj.y2??((obj.height??0)/2);
  const[cx1,cy1]=applyMatrix(matrix,x1,y1),[cx2,cy2]=applyMatrix(matrix,x2,y2);
  const[px1,py1]=toPdf(cx1,cy1,sx,sy,pdfH),[px2,py2]=toPdf(cx2,cy2,sx,sy,pdfH);
  const sp=parseColor(obj.stroke??"#000000",opacity);if(!sp)return;
  page.drawLine({start:{x:px1,y:py1},end:{x:px2,y:py2},thickness:(obj.strokeWidth??1)*Math.max(sx,sy),color:sp.color,opacity:sp.opacity});
}

function toUint8Array(data,label="data"){
  if(data instanceof Uint8Array)return data;
  if(data instanceof ArrayBuffer)return new Uint8Array(data);
  if(ArrayBuffer.isView(data))return new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
  if(Array.isArray(data))return new Uint8Array(data);
  if(data!==null&&typeof data==="object")return new Uint8Array(Object.values(data));
  throw new Error(`[pdfSaver] ${label}: unsupported type ${typeof data}`);
}


export async function savePdfWithAnnotations(pristinePdfData, canvasByPage, pristineBytes) {
  const safeData     = toUint8Array(pristinePdfData,"pristinePdfData");
  const safePristine = toUint8Array(pristineBytes,"pristineBytes");

  const pdfDoc = await PDFDocument.load(safeData,{ignoreEncryption:true});
  const pages  = pdfDoc.getPages();
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pageStates = {};
  for (let pageNum=1; pageNum<=pages.length; pageNum++) {
    const canvas=canvasByPage[pageNum];
    if(!canvas)continue;
    const serialised=canvas.toJSON();
    const objects=serialised.objects??[];
    if(objects.length===0)continue;
    pageStates[pageNum]=JSON.stringify(serialised);
    const page=pages[pageNum-1];
    const{width:pdfW,height:pdfH}=page.getSize();
    const sx=pdfW/(canvas.width||pdfW),sy=pdfH/(canvas.height||pdfH);
    for(const obj of objects) await renderObject(page,obj,sx,sy,pdfH,pdfDoc,font,null);
  }

  const annotatedBytes = toUint8Array(await pdfDoc.save());

  if(Object.keys(pageStates).length===0) return annotatedBytes;

  return appendIncrementalEmbeddedFiles(annotatedBytes,[
    {name:PRISTINE_NAME,    bytes:safePristine,                                                mimeType:"application/pdf"},
    {name:ANNOTATIONS_NAME, bytes:new TextEncoder().encode(JSON.stringify(pageStates)),         mimeType:"application/json"},
  ]);
}

export async function downloadPdf(pdfBytes,filePath){
  if(!filePath)return false;
  await writeFile(filePath,pdfBytes);
  return true;
}