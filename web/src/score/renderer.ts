// Promise wrapper around the Verovio worker. The worker (and the ~7 MB engraver
// it loads) is only created the first time a score is drawn.
import type { RenderRequest, RenderResponse } from "./verovio.worker";

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, (r: RenderResponse) => void>();

export function renderScore(
  data: ArrayBuffer,
  format: "musicxml" | "mxl",
  width: number,
  scale: number,
): Promise<string[]> {
  if (!worker) {
    worker = new Worker(new URL("./verovio.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<RenderResponse>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (r) => ("error" in r ? reject(new Error(r.error)) : resolve(r.pages)));
    const request: RenderRequest = { id, data, format, width, scale };
    worker!.postMessage(request);
  });
}
