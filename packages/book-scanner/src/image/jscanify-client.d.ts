/** Минимальные типы браузерной сборки jscanify (MIT, без своих типов). */
declare module 'jscanify/client' {
  interface Point {
    x: number;
    y: number;
  }
  interface CornerPoints {
    topLeftCorner?: Point;
    topRightCorner?: Point;
    bottomLeftCorner?: Point;
    bottomRightCorner?: Point;
  }
  class Jscanify {
    findPaperContour(img: unknown): unknown | null;
    getCornerPoints(contour: unknown): CornerPoints;
    extractPaper(
      image: HTMLCanvasElement | HTMLImageElement,
      resultWidth: number,
      resultHeight: number,
      cornerPoints?: CornerPoints,
    ): HTMLCanvasElement | null;
    highlightPaper(image: HTMLCanvasElement | HTMLImageElement): HTMLCanvasElement;
  }
  export default Jscanify;
}
