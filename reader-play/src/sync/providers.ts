// Transportes de sincronización multi-nube (Módulo 5). Cada proveedor solo
// lee/escribe un documento JSON; la fusión bidireccional vive en core/sync.ts.

import { mergeSyncDocuments, parseSyncDocument, type SyncDocument } from "../core/sync";

export type ProviderId = "dropbox" | "webdav" | "gdrive" | "ftp";

export interface ProviderConfig {
  provider: ProviderId;
  /** Dropbox / Google Drive: token OAuth de acceso. */
  token?: string;
  /** WebDAV: URL de la carpeta. FTP: URL de la pasarela HTTP. */
  url?: string;
  username?: string;
  password?: string;
  /** FTP: host/ruta remota que la pasarela debe usar. */
  ftpHost?: string;
}

export interface SyncProvider {
  download(): Promise<string | null>;
  upload(body: string): Promise<void>;
}

const FILE = "reader-play-sync.json";

async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status}`);
  return res;
}

function basicAuth(c: ProviderConfig): Record<string, string> {
  return c.username ? { Authorization: `Basic ${btoa(`${c.username}:${c.password ?? ""}`)}` } : {};
}

export function createProvider(c: ProviderConfig): SyncProvider {
  switch (c.provider) {
    case "webdav": {
      const url = `${(c.url ?? "").replace(/\/+$/, "")}/${FILE}`;
      return {
        async download() {
          const r = await fetch(url, { headers: basicAuth(c) });
          if (r.status === 404) return null;
          return (await ok(r, "WebDAV GET")).text();
        },
        async upload(body) {
          await ok(
            await fetch(url, { method: "PUT", headers: { ...basicAuth(c), "Content-Type": "application/json" }, body }),
            "WebDAV PUT",
          );
        },
      };
    }
    case "dropbox": {
      const auth = { Authorization: `Bearer ${c.token ?? ""}` };
      const arg = JSON.stringify({ path: `/${FILE}` });
      return {
        async download() {
          const r = await fetch("https://content.dropboxapi.com/2/files/download", {
            method: "POST",
            headers: { ...auth, "Dropbox-API-Arg": arg },
          });
          if (r.status === 409) return null; // path/not_found
          return (await ok(r, "Dropbox download")).text();
        },
        async upload(body) {
          await ok(
            await fetch("https://content.dropboxapi.com/2/files/upload", {
              method: "POST",
              headers: {
                ...auth,
                "Content-Type": "application/octet-stream",
                "Dropbox-API-Arg": JSON.stringify({ path: `/${FILE}`, mode: "overwrite", mute: true }),
              },
              body,
            }),
            "Dropbox upload",
          );
        },
      };
    }
    case "gdrive": {
      const auth = { Authorization: `Bearer ${c.token ?? ""}` };
      const findId = async (): Promise<string | null> => {
        const q = encodeURIComponent(`name='${FILE}'`);
        const r = await ok(
          await fetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`, {
            headers: auth,
          }),
          "Drive list",
        );
        return ((await r.json()).files?.[0]?.id as string) ?? null;
      };
      return {
        async download() {
          const id = await findId();
          if (!id) return null;
          return (await ok(await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: auth }), "Drive get")).text();
        },
        async upload(body) {
          const id = await findId();
          const boundary = "rp" + Math.random().toString(36).slice(2);
          const meta = id ? {} : { name: FILE, parents: ["appDataFolder"] };
          const multipart =
            `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n` +
            `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
          const url = id
            ? `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart`
            : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
          await ok(
            await fetch(url, {
              method: id ? "PATCH" : "POST",
              headers: { ...auth, "Content-Type": `multipart/related; boundary=${boundary}` },
              body: multipart,
            }),
            "Drive upload",
          );
        },
      };
    }
    case "ftp": {
      // Los navegadores no hablan FTP: se usa una pasarela HTTP (GET/PUT) que
      // reenvía al servidor FTP indicado. En una build nativa se sustituye por
      // un cliente FTP real con la misma interfaz.
      const url = `${(c.url ?? "").replace(/\/+$/, "")}/${FILE}?host=${encodeURIComponent(c.ftpHost ?? "")}`;
      return {
        async download() {
          const r = await fetch(url, { headers: basicAuth(c) });
          if (r.status === 404) return null;
          return (await ok(r, "FTP GET")).text();
        },
        async upload(body) {
          await ok(await fetch(url, { method: "PUT", headers: basicAuth(c), body }), "FTP PUT");
        },
      };
    }
  }
}

/** Ciclo completo: descarga, fusiona con lo local y sube el resultado. */
export async function syncNow(provider: SyncProvider, local: SyncDocument): Promise<SyncDocument> {
  const raw = await provider.download();
  const merged = mergeSyncDocuments(local, raw ? parseSyncDocument(raw) : null, new Date().toISOString());
  await provider.upload(JSON.stringify(merged));
  return merged;
}
