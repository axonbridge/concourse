// Builds the styled HTML document behind Word/PDF export. One builder, two
// formats: Word saves the returned HTML directly as .doc (opens natively in
// Word/Pages/Google Docs), PDF ships it over IPC to the main process, which
// prints it via Chromium's printToPDF. No converter dependencies either way.
// See ARCHITECTURE.md §10 — this file and the diagram-authoring palette in
// electron/knowledge/org-store.ts are the two homes of the house export style.

let mermaidExportSeq = 0;

// Re-render a mermaid diagram light-themed and rasterize it to a PNG for
// document exports. SVG <text> labels (htmlLabels off) rasterize reliably on
// canvas where foreignObject HTML labels don't; a concrete font stack replaces
// the CSS var, which can't resolve inside a detached svg image.
async function mermaidPngForExport(
  source: string,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const mermaid = (await import("mermaid")).default;
    // Exports render diagrams in the export palette (the compact card layout
    // style guide): teal-bordered pale-blue nodes on light surfaces, navy
    // text. classDef colors in the diagram source still override these.
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      securityLevel: "strict",
      fontFamily: 'Inter, "Segoe UI", Arial, Helvetica, sans-serif',
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true,
      themeVariables: {
        background: "transparent",
        primaryColor: "#dceff6",
        primaryBorderColor: "#19799a",
        primaryTextColor: "#153d5c",
        secondaryColor: "#e7f2f7",
        tertiaryColor: "#ffffff",
        mainBkg: "#dceff6",
        nodeBorder: "#19799a",
        lineColor: "#65758a",
        textColor: "#26384a",
        titleColor: "#153d5c",
        clusterBkg: "#f8fbfc",
        clusterBorder: "#c7dde8",
        edgeLabelBackground: "#e7f2f7",
        noteBkgColor: "#ffeccc",
        noteBorderColor: "#cf6600",
        noteTextColor: "#26384a",
        actorBkg: "#dceff6",
        actorBorder: "#19799a",
        actorTextColor: "#153d5c",
        actorLineColor: "#65758a",
        signalColor: "#65758a",
        signalTextColor: "#26384a",
        labelBoxBkgColor: "#e7f2f7",
        labelBoxBorderColor: "#c7dde8",
        labelTextColor: "#26384a",
        loopTextColor: "#26384a",
        activationBkgColor: "#e7f2f7",
        activationBorderColor: "#65758a",
      },
    });
    const { svg } = await mermaid.render(`mc-export-mermaid-${++mermaidExportSeq}`, source);
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-10000px;top:0;";
    host.innerHTML = svg;
    document.body.appendChild(host);
    const el = host.querySelector("svg");
    if (!el) {
      host.remove();
      return null;
    }
    const rect = el.getBoundingClientRect();
    const w = Math.max(1, Math.ceil(rect.width));
    const h = Math.max(1, Math.ceil(rect.height));
    el.setAttribute("width", String(w));
    el.setAttribute("height", String(h));
    const xml = new XMLSerializer().serializeToString(el);
    host.remove();
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("mermaid svg failed to load"));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    });
    const scale = 3;
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL("image/png"), width: w, height: h };
  } catch {
    return null;
  }
}

// Clone the rendered preview DOM and wrap it in a print-style document shell.
// Mermaid diagrams are re-rendered light-themed and rasterized to PNG first —
// Word can't parse SVG, and the on-screen theme may be dark against the
// export's white page.
export async function buildExportHtml(
  root: HTMLElement,
  relPath: string,
): Promise<{ title: string; doc: string } | null> {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const wrapper of Array.from(clone.querySelectorAll(".mc-md-mermaid"))) {
    const source = decodeURIComponent(wrapper.getAttribute("data-mermaid-source") ?? "");
    const png = source ? await mermaidPngForExport(source) : null;
    if (!png) continue; // keep the inline svg — PDF can still render it
    // Full page width — natural mermaid size reads tiny on a letter page.
    // Percentage lets Word and printToPDF each resolve against their own
    // content width; the 3x raster keeps it crisp at that size.
    const img = document.createElement("img");
    img.src = png.dataUrl;
    img.setAttribute("width", "100%"); // attribute form — Word's importer honors it
    img.style.cssText = "width:100%;height:auto;";
    wrapper.replaceWith(img);
  }
  // GFM task-list checkboxes arrive as disabled <input type="checkbox">.
  // Swap them for ☐/☑ glyphs — they print consistently, survive Word's HTML
  // importer (which drops form controls), and take color (green = done).
  for (const box of Array.from(clone.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
    const mark = document.createElement("span");
    mark.className = box.checked ? "mc-x-box mc-x-done" : "mc-x-box";
    mark.textContent = box.checked ? "☑ " : "☐ ";
    box.replaceWith(mark);
  }
  // Label headings render uppercase. CSS text-transform handles the PDF,
  // but Word's HTML importer doesn't honor it — uppercase the text itself.
  const walkTextNodes = (el: Element, fn: (t: Text) => void) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) fn(n as Text);
  };
  for (const label of Array.from(clone.querySelectorAll("h4"))) {
    walkTextNodes(label, (t) => {
      t.textContent = (t.textContent ?? "").toUpperCase();
    });
  }
  // Title area: a leading h1 (plus an immediately following paragraph as the
  // subtitle) becomes a centered document header with a teal rule below it.
  const mdRoot = clone.querySelector(".mc-md") ?? clone;
  const firstEl = mdRoot.firstElementChild;
  if (firstEl?.tagName === "H1") {
    const header = document.createElement("header");
    header.className = "mc-x-header";
    const sibling = firstEl.nextElementSibling;
    const subtitle = sibling?.tagName === "P" ? sibling : null;
    firstEl.replaceWith(header);
    header.appendChild(firstEl);
    if (subtitle) header.appendChild(subtitle);
  }
  const html = clone.innerHTML;
  if (!html) return null;
  const title = (relPath.split("/").pop() ?? "document").replace(/\.(md|markdown)$/i, "");
  // House document style — the compact professional card layout (Jesus
  // Guzman's PDF style guide): Inter/Arial body, navy #153D5C headings, teal
  // #19799A accents, rounded pale-blue section bars with a teal edge,
  // rounded light cards with subtle blue borders, ☐/☑ task checkboxes,
  // tight spacing so pages stay compact and phone-readable. Solid colors and
  // simple selectors so Word's HTML parser degrades gracefully (it just
  // ignores border-radius / break-inside).
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.25; color: #26384a; }
  p { margin: 5pt 0; }
  h1, h2, h3, h4 { color: #153d5c; page-break-after: avoid; break-after: avoid; }
  .mc-x-header { text-align: center; border-bottom: 2pt solid #19799a; padding-bottom: 8pt; margin-bottom: 10pt; }
  .mc-x-header h1 { font-size: 25pt; font-weight: 700; margin: 0; background: none; border: none; padding: 0; }
  .mc-x-header p { color: #65758a; font-size: 11pt; margin: 4pt 0 0; }
  h1, h2 { background: #e7f2f7; border-left: 5pt solid #19799a; border-radius: 7pt; padding: 7pt 10pt; margin: 12pt 0 6pt; }
  h1 { font-size: 16pt; font-weight: 700; }
  h2 { font-size: 15pt; font-weight: 700; }
  h3 { font-size: 12.5pt; font-weight: 700; margin: 10pt 0 4pt; }
  h4 { font-size: 9.5pt; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: #4c6579; margin: 7pt 0 3pt; }
  blockquote { background: #f8fbfc; border: 1pt solid #c7dde8; border-radius: 8pt; padding: 10pt 12pt; margin: 8pt 0; page-break-inside: avoid; break-inside: avoid; }
  blockquote p { margin: 3pt 0; }
  ul, ol { margin: 5pt 0; padding-left: 18pt; }
  li { margin: 2pt 0; }
  ul.contains-task-list { list-style: none; padding-left: 4pt; }
  .mc-x-box { color: #65758a; }
  .mc-x-done { color: #159a63; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0; }
  th, td { border: 1pt solid #c7dde8; padding: 4pt 8pt; text-align: left; vertical-align: top; }
  th { background: #e7f2f7; color: #153d5c; }
  code { font-family: Consolas, Menlo, monospace; font-size: 9.5pt; background: #eef4f8; border-radius: 4px; padding: 1pt 4pt; color: #26384a; }
  pre { background: #f8fbfc; border: 1pt solid #c7dde8; border-radius: 8pt; padding: 8pt 10pt; page-break-inside: avoid; break-inside: avoid; }
  pre code { background: none; padding: 0; }
  hr { border: none; border-top: 1pt solid #c7dde8; margin: 10pt 0; }
  a { color: #1684b5; text-decoration: underline; }
  strong { color: #153d5c; }
  img { max-width: 100%; }
</style>
<!--[if gte mso 9]><style>
  /* Word-only page setup, hidden from Chromium in a conditional comment so it
     can't fight the margins printToPDF is given. Mirrors the PDF: US Letter
     portrait, 0.5in margins. */
  @page WordSection1 { size: 8.5in 11.0in; margin: 0.5in 0.5in 0.5in 0.5in; }
  div.WordSection1 { page: WordSection1; }
</style><![endif]--></head>
<body><div class="WordSection1">${html}</div></body></html>`;
  return { title, doc };
}
