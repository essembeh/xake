// Evaluation graph of the displayed line, drawn as an inline SVG (spec 002 §4).
import { t } from "./i18n.js";
const W = 600;
const H = 120;
const NS = "http://www.w3.org/2000/svg";

const svg = (tag, attrs = {}) => {
  const out = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) out.setAttribute(k, v);
  return out;
};

// points: [{ id, percent|null, judgement|null, label }], one per position of the line (root first).
export function renderTimeline(container, points, currentIndex, onSelect) {
  container.replaceChildren();
  if (points.length < 2) {
    container.append(Object.assign(document.createElement("p"), { className: "muted", textContent: t("timeline.empty") }));
    return;
  }
  const step = W / (points.length - 1);
  const x = (i) => i * step;
  const y = (p) => H - (p / 100) * H;

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "timeline-svg" });
  root.append(svg("rect", { x: 0, y: 0, width: W, height: H, class: "tl-black" }));

  // Unknown evaluations hold the previous value so the area stays continuous while loading.
  let last = 50;
  const values = points.map((p) => (p.percent === null ? last : (last = p.percent)));
  const known = points.findLastIndex((p) => p.percent !== null);
  if (known > 0) {
    const coords = values.slice(0, known + 1).map((v, i) => `${x(i)},${y(v)}`);
    root.append(svg("polygon", { points: `0,${H} ${coords.join(" ")} ${x(known)},${H}`, class: "tl-white" }));
    root.append(svg("polyline", { points: coords.join(" "), class: "tl-line" }));
  }
  root.append(svg("line", { x1: 0, y1: H / 2, x2: W, y2: H / 2, class: "tl-mid" }));
  if (currentIndex >= 0) {
    root.append(svg("line", { x1: x(currentIndex), y1: 0, x2: x(currentIndex), y2: H, class: "tl-cursor" }));
  }
  container.append(root);

  // Dots live in HTML so they keep their shape despite the stretched SVG.
  const overlay = document.createElement("div");
  overlay.className = "tl-dots";
  points.forEach((p, i) => {
    if (!p.judgement || p.percent === null) return;
    const dot = document.createElement("button");
    dot.className = `tl-dot ${p.judgement.key}`;
    // Kept inside the box: the first/last move and decisive evals sit on an edge, where the dot would be clipped.
    dot.style.left = `${Math.max(2, Math.min(98, (x(i) / W) * 100))}%`;
    dot.style.top = `${Math.max(6, Math.min(94, (y(p.percent) / H) * 100))}%`;
    dot.title = `${p.label} ${p.judgement.glyph} — ${t(`judgement.${p.judgement.key}`)}`;
    dot.onclick = (event) => {
      event.stopPropagation();
      onSelect(p.id);
    };
    overlay.append(dot);
  });
  container.append(overlay);

  container.onclick = (event) => {
    const box = container.getBoundingClientRect();
    const index = Math.round(((event.clientX - box.left) / box.width) * (points.length - 1));
    onSelect(points[Math.max(0, Math.min(points.length - 1, index))].id);
  };
}
