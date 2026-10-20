declare module 'earcut' {
  /** Triangula um polígono (coordenadas planas [x0, y0, x1, y1, ...]) e devolve os índices dos triângulos. */
  export default function earcut(data: ArrayLike<number>, holeIndices?: ArrayLike<number> | null, dim?: number): number[];
}
