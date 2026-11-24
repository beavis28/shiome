// Squarified treemap（Bruls ほか）: 面積が value に比例し、なるべく正方形に近い長方形に分割する
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function worst(row: number[], side: number) {
  const s = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
}

/** values は大きい順に並べてから渡すと見た目が整う。戻り値は values と同じ順番 */
export function squarify(values: number[], rect: Rect): Rect[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (!values.length || total <= 0 || rect.w <= 0 || rect.h <= 0) return values.map(() => ({ ...rect, w: 0, h: 0 }));
  const scale = (rect.w * rect.h) / total;
  const areas = values.map((v) => Math.max(v, 0) * scale);
  const out: Rect[] = [];
  let { x, y, w, h } = rect;
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(w, h);
    const row = [areas[i]];
    let j = i + 1;
    while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) {
      row.push(areas[j]);
      j++;
    }
    const sum = row.reduce((a, b) => a + b, 0);
    if (w >= h) {
      // 左に縦 1 列で並べる
      const colW = sum / h;
      let yy = y;
      for (const a of row) {
        const hh = a / colW;
        out.push({ x, y: yy, w: colW, h: hh });
        yy += hh;
      }
      x += colW;
      w -= colW;
    } else {
      // 上に横 1 行で並べる
      const rowH = sum / w;
      let xx = x;
      for (const a of row) {
        const ww = a / rowH;
        out.push({ x: xx, y, w: ww, h: rowH });
        xx += ww;
      }
      y += rowH;
      h -= rowH;
    }
    i = j;
  }
  return out;
}
