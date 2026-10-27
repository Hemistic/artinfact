type Canvas = { width: number; height: number; getContext(type: '2d'): unknown };
// PDF.js transparency groups must use the same native canvas instance as Path2D.
// Its default NodeCanvasFactory resolves node_modules outside our packaged runtime.
export function pdfCanvasFactory(api: { createCanvas(width: number, height: number): Canvas }) {
  return class PackagedCanvasFactory {
    create(width: number, height: number) {
      const canvas = api.createCanvas(width, height); return { canvas, context: canvas.getContext('2d') };
    }
    reset(target: { canvas: Canvas }, width: number, height: number) { target.canvas.width = width; target.canvas.height = height; }
    destroy(target: { canvas: Canvas | null; context: unknown }) {
      if (target.canvas) { target.canvas.width = 1; target.canvas.height = 1; }
      target.canvas = null; target.context = null;
    }
  };
}
