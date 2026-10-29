// Score helpers shared by the eval bar, the timeline and move annotations (spec 002 §4).

export const hasMate = (score) => score.mate !== null && score.mate !== undefined;

export function formatScore(score) {
  if (!score) return "";
  if (hasMate(score)) return score.mate > 0 ? `M${score.mate}` : `-M${-score.mate}`;
  const pawns = score.cp / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

// Lichess win-probability curve, White's point of view, 0–100.
export function whitePercent(score) {
  if (hasMate(score)) return score.mate > 0 ? 100 : 0;
  const cp = Math.max(-1500, Math.min(1500, score.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// White win percentage of an analysis (score or terminal outcome), or null when unknown.
export function analysisPercent(analysis) {
  if (!analysis) return null;
  if (analysis.outcome) return { "1-0": 100, "0-1": 0 }[analysis.outcome.result] ?? 50;
  return analysis.score ? whitePercent(analysis.score) : null;
}

// Labels are translated (i18n.js): judgement.<key>.
export const JUDGEMENTS = [
  { key: "blunder", glyph: "??", loss: 15 },
  { key: "mistake", glyph: "?", loss: 10 },
  { key: "inaccuracy", glyph: "?!", loss: 5 },
];

// My move matching Stockfish's first choice; shown as a dot, not a glyph.
export const BEST = { key: "best", glyph: "" };

// `mover` is the colour that played the move between the two evaluations.
export function judge(before, after, mover) {
  if (before === null || after === null) return null;
  const loss = mover === "white" ? before - after : after - before;
  return JUDGEMENTS.find((j) => loss >= j.loss) || null;
}

const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const START_COUNTS = { q: 1, r: 2, b: 2, n: 2, p: 8 };

// Material balance from a FEN: White's lead in points (negative when Black leads) and, per side,
// the opponent pieces it captured (missing from the start set; a promoted pawn counts as taken).
export function materialDiff(fen) {
  const counts = {};
  for (const ch of fen.split(" ")[0]) {
    if (/[pnbrqPNBRQ]/.test(ch)) counts[ch] = (counts[ch] || 0) + 1;
  }
  const captured = { white: [], black: [] };
  let score = 0;
  for (const role of ["q", "r", "b", "n", "p"]) {
    const white = counts[role.toUpperCase()] || 0;
    const black = counts[role] || 0;
    score += (white - black) * VALUES[role];
    for (let i = black; i < START_COUNTS[role]; i++) captured.white.push(role);
    for (let i = white; i < START_COUNTS[role]; i++) captured.black.push(role);
  }
  return { score, captured };
}
