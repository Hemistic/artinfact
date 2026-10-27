type Assets = Record<string, string>;
type LocalViewer = Window & { __CODEX_ASSETS__: Assets; __codexPdfOptions?: object };

export function localPdfFactories(assets: Assets) {
  const bytes = (path: string) => {
    const value = assets[path];
    if (!value) throw new Error(`内置 PDF 资源缺失：${path}`);
    return Uint8Array.from(atob(value), char => char.charCodeAt(0));
  };
  return {
    CMapReaderFactory: class { async fetch({ name }: { name: string }) { return { cMapData: bytes(`cmaps/${name}.bcmap`), isCompressed: true }; } },
    StandardFontDataFactory: class { async fetch({ filename }: { filename: string }) { return bytes(`standard_fonts/${filename}`); } },
    WasmFactory: class { async fetch({ filename }: { filename: string }) { return bytes(`wasm/${filename}`); } },
  };
}

export function prepareLocalViewer() {
  const local = window as unknown as LocalViewer;
  local.__codexPdfOptions = { ...localPdfFactories(local.__CODEX_ASSETS__), useWorkerFetch: false, isEvalSupported: false, enableScripting: false };
  // build-reader starts a dedicated bundled Blob Worker before PDF.js opens the document.
}
