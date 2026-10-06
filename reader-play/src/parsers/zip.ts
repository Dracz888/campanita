// Lector ZIP mínimo (EPUB es un ZIP). Usa DecompressionStream("deflate-raw"),
// disponible en navegadores modernos y en Node >= 18.

export interface ZipArchive {
  names(): string[];
  has(name: string): boolean;
  bytes(name: string): Promise<Uint8Array>;
  text(name: string): Promise<string>;
}

interface Entry {
  method: number;
  compSize: number;
  localOffset: number;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function openZip(buf: ArrayBuffer): ZipArchive {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  // Fin del directorio central: firma 0x06054b50 buscada desde el final.
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Archivo ZIP no válido");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map<string, Entry>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Directorio ZIP corrupto");
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const bytes = async (name: string): Promise<Uint8Array> => {
    const e = entries.get(name) ?? entries.get(decodeURIComponent(name));
    if (!e) throw new Error(`No existe en el ZIP: ${name}`);
    const lo = e.localOffset;
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const data = u8.subarray(start, start + e.compSize);
    if (e.method === 0) return data.slice();
    if (e.method === 8) return inflateRaw(data);
    throw new Error(`Compresión ZIP no soportada (${e.method})`);
  };

  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name) || entries.has(decodeURIComponent(name)),
    bytes,
    text: async (name) => new TextDecoder("utf-8").decode(await bytes(name)),
  };
}

/** Resuelve una ruta relativa respecto al directorio de `base` ("OEBPS/a/b.xhtml"). */
export function resolvePath(base: string, rel: string): string {
  if (/^[a-z]+:/i.test(rel)) return rel;
  const parts = base.split("/").slice(0, -1);
  for (const seg of rel.split("#")[0].split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}
