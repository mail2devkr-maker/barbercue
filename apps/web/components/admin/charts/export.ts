// Client-side chart exports. The SVG uses CSS-module classes, so computed paint/text styles are
// copied inline before rasterising — otherwise the PNG would lose its axis text and grid colours.

const STYLE_PROPS = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-size", "font-weight", "font-family"];

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const source = svg.querySelectorAll<SVGElement>("*");
  const target = clone.querySelectorAll<SVGElement>("*");
  source.forEach((node, i) => {
    const computed = window.getComputedStyle(node);
    const style = STYLE_PROPS.map((p) => `${p}:${computed.getPropertyValue(p)}`).join(";");
    target[i].setAttribute("style", style);
  });
  const width = svg.viewBox.baseVal.width || svg.clientWidth;
  const height = svg.viewBox.baseVal.height || svg.clientHeight;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  // CSS variables do not survive serialisation; resolve the surface colour explicitly.
  const surface = window.getComputedStyle(svg).getPropertyValue("--chart-surface").trim() || "#211e29";
  clone.querySelectorAll("rect").forEach((r) => {
    if (r.getAttribute("fill")?.startsWith("var(")) r.setAttribute("fill", surface);
  });
  clone.querySelectorAll("circle").forEach((c) => {
    if (c.getAttribute("fill")?.startsWith("var(")) c.setAttribute("fill", surface);
  });

  const markup = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not render the chart image"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");
    ctx.scale(scale, scale);
    ctx.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
