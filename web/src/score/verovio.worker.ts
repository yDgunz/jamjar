// Verovio (the notation engraver, compiled to WebAssembly) runs here, off the
// main thread: drawing a long piece takes a few hundred ms and would otherwise
// freeze the page, and it redraws on every resize and zoom.
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";

export interface RenderRequest {
  id: number;
  data: ArrayBuffer;
  format: "musicxml" | "mxl";
  width: number; // px available for the score
  scale: number; // Verovio scale, percent
}

export type RenderResponse =
  | { id: number; pages: string[] }
  | { id: number; error: string };

const toolkit = createVerovioModule().then((module) => new VerovioToolkit(module));

self.onmessage = async (e: MessageEvent<RenderRequest>) => {
  const { id, data, format, width, scale } = e.data;
  const post = (msg: RenderResponse) => (self as unknown as Worker).postMessage(msg);
  try {
    const tk = await toolkit;
    tk.setOptions({
      scale,
      pageWidth: Math.max(500, Math.round((width * 100) / scale)),
      pageHeight: 60000, // one tall page: a continuous scroll of systems
      adjustPageHeight: true,
      breaks: "auto",
      footer: "none",
      // Margins in screen px whatever the zoom; the left one leaves room for the
      // brace and bar numbers that sit outside the staff.
      pageMarginLeft: Math.round((14 * 100) / scale),
      pageMarginRight: Math.round((10 * 100) / scale),
      pageMarginTop: 20,
    });
    const loaded =
      format === "mxl"
        ? tk.loadZipDataBuffer(data)
        : tk.loadData(new TextDecoder().decode(data));
    if (!loaded) throw new Error("this file could not be read as MusicXML");
    const count = tk.getPageCount();
    post({ id, pages: Array.from({ length: count }, (_, p) => tk.renderToSVG(p + 1)) });
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
