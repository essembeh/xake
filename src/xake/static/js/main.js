import { Chessground } from "../vendor/chessground/chessground.min.js";
import { validateFen } from "../vendor/chess.js/chess.js";
import * as api from "./api.js";
import { analysisPercent, formatScore, judge, materialDiff } from "./evaluation.js";
import { LANGUAGES, language, serverDefault, setLanguage, sideName, t } from "./i18n.js";
import { exportPgn, importPgn } from "./pgn.js";
import * as storage from "./storage.js";
import { BOARD_THEMES, PIECE_SETS, UI_THEMES, applyThemes, pieceUrl } from "./themes.js";
import { gameFromHash, gameToUrl } from "./share.js";
import * as sounds from "./sounds.js";
import { renderTimeline } from "./timeline.js";
import * as tree from "./tree.js";

const ENGINE_MIN_DELAY_MS = 300;
const ANALYSIS_DEBOUNCE_MS = 120;
const TIMELINE_MOVETIME_MS = 150;
const PV_PLIES = 10;
// One colour per best-move rank, shared by the arrows and the list badges (spec 002 §3).
const RANK_COLORS = ["#2e9e3e", "#2f6fd6", "#e8890c", "#9b4fc9", "#6b6b6b"];
const ROLE_NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen" };

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const out = Object.assign(document.createElement(tag), props);
  out.append(...children);
  return out;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let prefs = storage.loadPrefs();
// A piece set removed from the bundle would leave broken images (promotion, material strip).
if (!PIECE_SETS[prefs.pieceSet]) prefs.pieceSet = storage.DEFAULT_PREFS.pieceSet;
let game = storage.loadCurrentGame() || tree.newGame({ playerColor: prefs.playerColor, elo: prefs.elo });
let orientation = game.playerColor;
let thinking = false;
let engineCtrl = null;
let analysisCtrl = null;
let analysisTimer = null;
let analysisError = false;
let redo = null;
let evalBusy = false;
let evalCtrl = null;
let evalRetryTimer = null;
const analysisCache = new Map();
// Best available evaluation per node: quick timeline pass, overridden by full analyses.
const evals = new Map();
const dismissedGameOver = new Set();

const brushes = Object.fromEntries(
  RANK_COLORS.map((color, i) => [`rank${i + 1}`, { key: `r${i + 1}`, color, opacity: i === 0 ? 0.95 : 0.85, lineWidth: i === 0 ? 13 : 10 }]),
);

const cg = Chessground($("board"), {
  coordinates: prefs.coordinates,
  blockTouchScroll: true,
  highlight: { lastMove: true, check: true },
  animation: { enabled: true, duration: 180 },
  draggable: { showGhost: true },
  premovable: { enabled: false },
  movable: { free: false, showDests: true, events: { after: onBoardMove } },
  drawable: { enabled: true, eraseOnClick: true, brushes },
});

// ---- Helpers ----

const colorOf = (chess) => (chess.turn() === "w" ? "white" : "black");
const turnOfFen = (fen) => (fen.split(" ")[1] === "w" ? "white" : "black");
const position = (id) => ({ start_fen: game.startFen, moves: tree.ucis(game, id) });
const analysisKey = (id) => `${id}:${prefs.multipv}`;
const percentOf = (id) => analysisPercent(evals.get(id));
const wantsAnalysis = () => prefs.showAnalysis || prefs.showBestMoves;
const anyDialogOpen = () => document.querySelector("dialog[open]") !== null;

function dests(chess) {
  const out = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!out.has(m.from)) out.set(m.from, []);
    out.get(m.from).push(m.to);
  }
  return out;
}

function persist() {
  if (!storage.saveGame(game)) toast(t("app.saveFailed"));
}

function canUserMove(chess) {
  return !thinking && !chess.isGameOver() && (game.twoSides || colorOf(chess) === game.playerColor);
}

function cancelEngine() {
  engineCtrl?.abort();
  engineCtrl = null;
  thinking = false;
}

function judgementOf(n) {
  if (!prefs.showAnalysis || n.parent === null) return null;
  return judge(percentOf(n.parent), percentOf(n.id), turnOfFen(tree.node(game, n.parent).fen));
}

// Root, path to the current node, then the main line continuing from it.
function displayedLine() {
  const out = [game.rootId, ...tree.path(game, game.currentId).map((n) => n.id)];
  for (let n = tree.current(game); n.children.length; ) {
    n = tree.node(game, n.children[0]);
    out.push(n.id);
  }
  return out;
}

function gameOverInfo(chess) {
  if (chess.isCheckmate()) {
    const winner = colorOf(chess) === "white" ? "black" : "white";
    return { winner, result: winner === "white" ? "1-0" : "0-1", reason: t("over.checkmate") };
  }
  const draw = (reason) => ({ winner: null, result: "½-½", reason });
  if (chess.isStalemate()) return draw(t("over.stalemate"));
  if (chess.isThreefoldRepetition()) return draw(t("over.threefold"));
  if (chess.isInsufficientMaterial()) return draw(t("over.material"));
  if (chess.isDrawByFiftyMoves()) return draw(t("over.fifty"));
  return null;
}

let toastTimer = null;
function toast(message, actionLabel = null, action = null, ms = 4000) {
  const box = $("toast");
  box.replaceChildren(el("span", { textContent: message }));
  if (actionLabel) {
    const button = el("button", { textContent: actionLabel });
    button.onclick = () => {
      box.hidden = true;
      action();
    };
    box.append(button);
  }
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), ms);
}

// ---- Rendering ----

function render() {
  const n = tree.current(game);
  const chess = tree.chessAt(game, n.id);
  const turn = colorOf(chess);
  const movable = canUserMove(chess);
  cg.set({
    fen: n.fen,
    orientation,
    turnColor: turn,
    check: chess.inCheck(),
    lastMove: n.uci ? [n.uci.slice(0, 2), n.uci.slice(2, 4)] : undefined,
    movable: { color: movable ? (game.twoSides ? "both" : turn) : undefined, dests: movable ? dests(chess) : new Map() },
  });
  renderStrips(n, turn);
  renderStatus(chess, turn);
  renderControls();
  renderToggles();
  renderMoves();
  renderBookmarks();
  renderAnalysis();
  renderTimelineCard();
  renderGameOver(n, chess);
}

function renderStrips(n, turn) {
  const { score, pieces } = materialDiff(n.fen);
  const strip = (color) => {
    const isEngine = !game.twoSides && color !== game.playerColor;
    const name = game.twoSides ? sideName(color) : isEngine ? "Stockfish" : t("strip.you");
    const out = [el("i", { className: `side-dot ${color}` }), el("span", { className: "name", textContent: name })];
    if (isEngine) {
      const elo = el("button", { className: "elo", textContent: game.elo, title: t("strip.changeLevel") });
      elo.onclick = () => openSettings();
      out.push(elo);
      if (thinking) out.push(el("span", { className: "thinking", textContent: t("strip.thinking") }));
    }
    const material = el("span", { className: "material" });
    const opponent = color === "white" ? "black" : "white";
    for (const role of pieces[color]) {
      material.append(el("img", { src: pieceUrl(prefs.pieceSet, opponent, ROLE_NAMES[role]), alt: "" }));
    }
    const advantage = color === "white" ? score : -score;
    if (advantage > 0) material.append(el("b", { textContent: `+${advantage}` }));
    out.push(el("span", { className: "spacer" }), material);
    // Orientation only, kept discreet next to the board; swapping sides is the main control.
    if (color === orientation) {
      const flipButton = el("button", { className: "flip", title: t("strip.flip"), ariaLabel: t("strip.flip") });
      flipButton.innerHTML = '<svg><use href="#i-flip" /></svg>';
      flipButton.onclick = flip;
      out.push(flipButton);
    }
    return out;
  };
  const top = orientation === "white" ? "black" : "white";
  for (const [id, color] of [
    ["strip-top", top],
    ["strip-bottom", orientation],
  ]) {
    $(id).replaceChildren(...strip(color));
    $(id).classList.toggle("active", color === turn);
  }
}

function renderStatus(chess, turn) {
  const over = gameOverInfo(chess);
  let text;
  if (over) text = `${over.reason}${over.winner ? "" : t("status.draw")} (${over.result})`;
  else if (thinking) text = t("status.thinking");
  else if (game.twoSides) text = t("status.sideToMove", { side: sideName(turn) });
  else if (turn === game.playerColor) text = chess.inCheck() ? t("status.checkYourTurn") : t("status.yourTurn");
  else text = t("status.engineTurn");
  $("status").textContent = text;
}

function renderControls() {
  const n = tree.current(game);
  const atRoot = n.parent === null;
  $("btn-first").disabled = atRoot;
  $("btn-prev").disabled = atRoot;
  $("btn-next").disabled = !n.children.length;
  $("btn-last").disabled = !n.children.length;
  $("btn-undo").disabled = atRoot;
  $("btn-bookmark").classList.toggle(
    "active",
    game.bookmarks.some((b) => b.nodeId === n.id),
  );
}

function renderToggles() {
  $("btn-sound").setAttribute("aria-pressed", String(prefs.sound));
  $("btn-sound").title = t(prefs.sound ? "tb.soundOn" : "tb.soundOff");
  $("btn-sound").querySelector("use").setAttribute("href", prefs.sound ? "#i-sound" : "#i-mute");
  $("btn-best").setAttribute("aria-pressed", String(prefs.showBestMoves));
  $("btn-analysis").setAttribute("aria-pressed", String(prefs.showAnalysis));
  $("btn-two-sides").setAttribute("aria-pressed", String(game.twoSides));
}

function moveLabelEl(n, prefix) {
  const out = el("span", { className: "mv", textContent: prefix + n.san });
  out.dataset.id = n.id;
  if (n.id === game.currentId) out.classList.add("current");
  const judgement = judgementOf(n);
  if (judgement) out.append(el("sup", { className: `glyph ${judgement.key}`, textContent: judgement.glyph, title: t(`judgement.${judgement.key}`) }));
  if (game.bookmarks.some((b) => b.nodeId === n.id)) out.classList.add("bookmarked");
  return out;
}

// Inline rendering for variations, nested in parentheses-like blocks.
function renderInline(fromId, container, forceNumber) {
  let n = tree.node(game, fromId);
  let needNumber = forceNumber;
  while (n.children.length) {
    const [main, ...alternatives] = n.children.map((id) => tree.node(game, id));
    const [, turn, , , , number] = n.fen.split(" ");
    const prefix = turn === "w" ? `${number}. ` : needNumber ? `${number}… ` : "";
    container.append(moveLabelEl(main, prefix), " ");
    needNumber = false;
    for (const alt of alternatives) {
      const variation = el("span", { className: "variation" });
      const altPrefix = turn === "w" ? `${number}. ` : `${number}… `;
      variation.append(moveLabelEl(alt, altPrefix), " ");
      renderInline(alt.id, variation, false);
      container.append(variation);
      needNumber = true;
    }
    n = main;
  }
}

// Main line as a number / White / Black table; variations are inserted under their branch point.
function renderMoves() {
  const box = $("moves");
  box.replaceChildren();
  let n = tree.node(game, game.rootId);
  if (!n.children.length) {
    box.append(el("p", { className: "empty", textContent: t("moves.empty") }));
    return;
  }
  let rowOpen = false;
  const cell = (node) => {
    const out = el("div", { className: "cell" }, moveLabelEl(node, ""));
    const percent = percentOf(node.id);
    if (prefs.showAnalysis && percent !== null) {
      const evalText = formatScore(evals.get(node.id)?.score) || evals.get(node.id)?.outcome?.result || "";
      out.append(el("small", { className: "cell-eval", textContent: evalText }));
    }
    return out;
  };
  while (n.children.length) {
    const [main, ...alternatives] = n.children.map((id) => tree.node(game, id));
    const [, turn, , , , number] = n.fen.split(" ");
    if (turn === "w") {
      box.append(el("div", { className: "num", textContent: number }), cell(main));
      rowOpen = true;
    } else {
      if (!rowOpen) box.append(el("div", { className: "num", textContent: number }), el("div", { className: "cell filler", textContent: "…" }));
      box.append(cell(main));
      rowOpen = false;
    }
    if (alternatives.length) {
      if (rowOpen) box.append(el("div", { className: "cell filler", textContent: "…" }));
      rowOpen = false;
      const block = el("div", { className: "variations" });
      for (const alt of alternatives) {
        const line = el("div", { className: "variation-line" });
        line.append(moveLabelEl(alt, turn === "w" ? `${number}. ` : `${number}… `), " ");
        renderInline(alt.id, line, false);
        block.append(line);
      }
      box.append(block);
    }
    n = main;
  }
  if (rowOpen) box.append(el("div", { className: "cell filler" }));
  keepCurrentMoveVisible(box);
}

// Scrolls the move list only: scrollIntoView would also scroll the page and push the board off a phone screen.
function keepCurrentMoveVisible(box) {
  const current = box.querySelector(".mv.current");
  const scroller = box.closest(".moves-card");
  if (!current || scroller.scrollHeight <= scroller.clientHeight) return;
  const item = current.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  if (item.top < view.top || item.bottom > view.bottom) scroller.scrollTop += item.top - view.top - view.height / 2;
}

function renderBookmarks() {
  const list = $("bookmarks");
  list.replaceChildren();
  $("bookmarks-section").hidden = !game.bookmarks.length;
  for (const bookmark of game.bookmarks) {
    const go = el("button", { className: "go", innerHTML: '<svg><use href="#i-bookmark" /></svg>' });
    go.append(el("span", { textContent: bookmark.label }));
    go.classList.toggle("current", bookmark.nodeId === game.currentId);
    go.onclick = () => goTo(bookmark.nodeId);
    const rename = el("button", { className: "small", textContent: "✎", title: t("bookmark.rename") });
    rename.onclick = () => {
      const label = prompt(t("bookmark.prompt"), bookmark.label);
      if (label) {
        bookmark.label = label;
        persist();
        renderBookmarks();
      }
    };
    const remove = el("button", { className: "small", textContent: "✕", title: t("bookmark.delete") });
    remove.onclick = () => {
      game.bookmarks = game.bookmarks.filter((b) => b.id !== bookmark.id);
      persist();
      render();
    };
    list.append(el("li", {}, go, rename, remove));
  }
}

function pvTokens(fromFen, sans) {
  let [, turn, , , , number] = fromFen.split(" ");
  number = Number(number);
  const out = [];
  sans.slice(0, PV_PLIES).forEach((san, i) => {
    if (turn === "w") out.push(`${number}. ${san}`);
    else out.push(i === 0 ? `${number}… ${san}` : san);
    if (turn === "b") number += 1;
    turn = turn === "w" ? "b" : "w";
  });
  return out;
}

function renderEvalBar(analysis) {
  const bar = $("evalbar");
  bar.classList.toggle("flipped", orientation === "black");
  bar.classList.toggle("off", !prefs.showAnalysis);
  const percent = analysisPercent(analysis);
  if (percent === null) return;
  bar.querySelector(".evalbar-white").style.height = `${percent}%`;
  const label = bar.querySelector(".evalbar-label");
  label.textContent = analysis.outcome
    ? analysis.outcome.result === "1/2-1/2"
      ? "½"
      : analysis.outcome.result
    : formatScore(analysis.score).replace("+", "");
  const atBottom = percent >= 50 === (orientation === "white");
  label.className = `evalbar-label ${atBottom ? "bottom" : "top"}`;
}

function renderAnalysis() {
  const n = tree.current(game);
  const analysis = analysisCache.get(analysisKey(n.id));
  renderEvalBar(analysis || evals.get(n.id));

  const lines = $("lines");
  lines.hidden = !prefs.showBestMoves;
  lines.replaceChildren();
  let shapes = [];
  if (prefs.showBestMoves) {
    if (analysis?.outcome) {
      lines.append(el("div", { className: "line muted", textContent: t("lines.gameOver") }));
    } else if (analysis) {
      analysis.lines.forEach((line, i) => {
        const button = el("button", { className: "line", title: t("lines.playThis") });
        const badge = el("span", { className: "rank", textContent: i + 1 });
        badge.style.background = RANK_COLORS[i];
        const [first, ...rest] = pvTokens(n.fen, line.pv_san);
        button.append(
          badge,
          el("span", { className: "score", textContent: formatScore(line.score) }),
          el("span", { className: "pv" }, el("b", { textContent: first }), ` ${rest.join(" ")}`),
        );
        button.onclick = () => {
          if (canUserMove(tree.chessAt(game, game.currentId))) playMove(line.uci, "me");
        };
        lines.append(button);
      });
      // Drawn worst first so the best arrow ends up on top.
      shapes = analysis.lines
        .map((line, i) => ({
          orig: line.uci.slice(0, 2),
          dest: line.uci.slice(2, 4),
          brush: `rank${i + 1}`,
          label: { text: String(i + 1), fill: RANK_COLORS[i] },
        }))
        .reverse();
    } else {
      const text = analysisError ? t("lines.unavailable") : t("lines.computing");
      lines.append(el("div", { className: "line muted", textContent: text }));
    }
  }
  cg.setAutoShapes(shapes);
}

function renderTimelineCard() {
  $("timeline-card").hidden = !prefs.showAnalysis;
  if (!prefs.showAnalysis) return;
  const ids = displayedLine();
  const points = ids.map((id) => {
    const n = tree.node(game, id);
    return {
      id,
      percent: percentOf(id),
      judgement: judgementOf(n),
      label: n.parent === null ? t("timeline.start") : tree.moveLabel(game, n),
    };
  });
  const missing = points.filter((p) => p.percent === null).length;
  $("timeline-progress").textContent = missing ? t("timeline.progress", { done: ids.length - missing, total: ids.length }) : "";
  renderTimeline($("timeline"), points, ids.indexOf(game.currentId), goTo);
}

function renderGameOver(n, chess) {
  const box = $("gameover");
  const over = gameOverInfo(chess);
  if (!over || dismissedGameOver.has(n.id)) {
    box.hidden = true;
    return;
  }
  let title;
  if (!over.winner) title = t("gameover.draw");
  else if (game.twoSides) title = t(over.winner === "white" ? "gameover.whiteWins" : "gameover.blackWins");
  else title = t(over.winner === game.playerColor ? "gameover.win" : "gameover.loss");
  const analyse = el("button", { textContent: t("gameover.analyse") });
  analyse.onclick = () => {
    dismissedGameOver.add(n.id);
    if (!prefs.showAnalysis) updatePrefs({ showAnalysis: true });
    else render();
  };
  const again = el("button", { className: "primary", textContent: t("tb.new") });
  again.onclick = () => openNewGame();
  box.replaceChildren(
    el(
      "div",
      { className: "gameover-card" },
      el("strong", { textContent: title }),
      el("span", { textContent: `${over.reason} · ${over.result}` }),
      el("div", { className: "row" }, analyse, again),
    ),
  );
  box.hidden = false;
}

// ---- Engine & analysis ----

function scheduleAnalysis() {
  clearTimeout(analysisTimer);
  analysisCtrl?.abort();
  analysisError = false;
  pumpEvals();
  if (!wantsAnalysis()) return;
  const id = game.currentId;
  if (analysisCache.has(analysisKey(id))) return;
  analysisTimer = setTimeout(() => runAnalysis(id), ANALYSIS_DEBOUNCE_MS);
}

async function runAnalysis(id) {
  const ctrl = (analysisCtrl = new AbortController());
  try {
    const analysis = await api.analyse(position(id), prefs.multipv, ctrl.signal);
    analysisCache.set(analysisKey(id), analysis);
    evals.set(id, analysis);
  } catch (error) {
    if (api.isAbort(error)) return;
    console.warn("analysis failed", error);
    analysisError = true;
  }
  if (game.currentId === id) render();
}

// Evaluates the displayed line one position at a time for the timeline (spec 002 §4).
async function pumpEvals() {
  if (evalBusy || !prefs.showAnalysis) return;
  const id = displayedLine().find((nodeId) => !evals.has(nodeId));
  if (!id) return;
  evalBusy = true;
  const gameId = game.id;
  const ctrl = (evalCtrl = new AbortController());
  let failed = false;
  try {
    const analysis = await api.analyse(position(id), 1, ctrl.signal, TIMELINE_MOVETIME_MS);
    if (game.id === gameId && !evals.has(id)) evals.set(id, analysis);
  } catch (error) {
    failed = !api.isAbort(error);
  } finally {
    evalBusy = false;
  }
  if (game.id !== gameId || ctrl.signal.aborted) return;
  renderMoves();
  renderTimelineCard();
  if (failed) {
    clearTimeout(evalRetryTimer);
    evalRetryTimer = setTimeout(pumpEvals, 5000);
  } else {
    pumpEvals();
  }
}

async function maybeEngineMove() {
  const n = tree.current(game);
  if (game.twoSides || n.children.length || thinking) return;
  const chess = tree.chessAt(game, n.id);
  if (chess.isGameOver() || colorOf(chess) === game.playerColor) return;

  const ctrl = (engineCtrl = new AbortController());
  thinking = true;
  render();
  const started = performance.now();
  try {
    const move = await api.engineMove(position(n.id), game.elo, ctrl.signal);
    await sleep(Math.max(0, ENGINE_MIN_DELAY_MS - (performance.now() - started)));
    if (ctrl.signal.aborted || game.currentId !== n.id) return;
    engineCtrl = null;
    thinking = false;
    playMove(move.uci, "engine");
  } catch (error) {
    if (api.isAbort(error)) return;
    console.warn("engine move failed", error);
    toast(t("engine.unavailable"), t("action.retry"), () => maybeEngineMove(), 8000);
  } finally {
    if (engineCtrl === ctrl) {
      engineCtrl = null;
      thinking = false;
      render();
    }
  }
}

// ---- Actions ----

function playMove(uci, by) {
  const n = tree.addMove(game, game.currentId, uci, by, by === "engine" ? { elo: game.elo } : {});
  game.currentId = n.id;
  redo = null;
  if (prefs.sound) {
    const over = gameOverInfo(tree.chessAt(game, n.id));
    sounds.play(sounds.soundFor(n.san, over, game.twoSides ? null : game.playerColor));
  }
  persist();
  render();
  scheduleAnalysis();
  maybeEngineMove();
}

function askPromotion(color) {
  const overlay = $("promotion");
  return new Promise((resolve) => {
    const choices = el("div", { className: "choices" });
    for (const [letter, role] of [
      ["q", "queen"],
      ["r", "rook"],
      ["b", "bishop"],
      ["n", "knight"],
    ]) {
      const button = el("button", {}, el("img", { src: pieceUrl(prefs.pieceSet, color, role), alt: role }));
      button.onclick = (event) => {
        event.stopPropagation();
        overlay.hidden = true;
        resolve(letter);
      };
      choices.append(button);
    }
    overlay.replaceChildren(choices);
    overlay.onclick = () => {
      overlay.hidden = true;
      resolve(null);
    };
    overlay.hidden = false;
  });
}

async function onBoardMove(orig, dest) {
  const chess = tree.chessAt(game, game.currentId);
  const candidates = chess.moves({ verbose: true }).filter((m) => m.from === orig && m.to === dest);
  if (!candidates.length) return render();
  let uci = orig + dest;
  if (candidates.some((m) => m.promotion)) {
    const letter = await askPromotion(colorOf(chess));
    if (!letter) return render();
    uci += letter;
  }
  playMove(uci, "me");
}

function goTo(id) {
  if (!tree.node(game, id) || id === game.currentId) return;
  cancelEngine();
  game.currentId = id;
  persist();
  render();
  scheduleAnalysis();
  maybeEngineMove();
}

// Takes back my last move and the engine reply, deleting them only when nothing branches off (spec 001 §6.5).
function undo() {
  const n = tree.current(game);
  if (n.parent === null) return;
  cancelEngine();
  const steps = game.twoSides || n.by !== "engine" ? 1 : 2;
  let target = n;
  for (let i = 0; i < steps && target.parent !== null; i++) target = tree.node(game, target.parent);
  const child = tree.path(game, n.id)[tree.path(game, target.id).length];
  if (tree.isBareChain(game, target.id, n.id)) {
    redo = { snapshot: tree.removeSubtree(game, child.id), currentId: n.id };
    toast(t("undo.done"), t("undo.redo"), doRedo);
  }
  game.currentId = target.id;
  persist();
  render();
  scheduleAnalysis();
  maybeEngineMove();
}

function doRedo() {
  if (!redo) return;
  cancelEngine();
  tree.restoreSubtree(game, redo.snapshot);
  game.currentId = redo.currentId;
  redo = null;
  persist();
  render();
  scheduleAnalysis();
}

function toggleBookmark() {
  const n = tree.current(game);
  const existing = game.bookmarks.find((b) => b.nodeId === n.id);
  if (existing) {
    game.bookmarks = game.bookmarks.filter((b) => b !== existing);
    toast(t("bookmark.removed"));
  } else {
    tree.addBookmark(game, n.id, n.parent === null ? t("bookmark.start") : tree.moveLabel(game, n));
    toast(t("bookmark.added"));
  }
  persist();
  render();
}

function step(direction) {
  const n = tree.current(game);
  if (direction < 0 && n.parent !== null) goTo(n.parent);
  if (direction > 0 && n.children.length) goTo(n.children[0]);
}

function openGame(next) {
  cancelEngine();
  clearTimeout(analysisTimer);
  clearTimeout(evalRetryTimer);
  analysisCtrl?.abort();
  evalCtrl?.abort();
  evalBusy = false;
  analysisCache.clear();
  evals.clear();
  dismissedGameOver.clear();
  redo = null;
  game = next;
  orientation = game.playerColor;
  prefs.elo = game.elo;
  storage.savePrefs(prefs);
  persist();
  syncSettings();
  render();
  scheduleAnalysis();
  maybeEngineMove();
}

function startNewGame(colorChoice, elo, fen) {
  const playerColor = colorChoice === "random" ? (Math.random() < 0.5 ? "white" : "black") : colorChoice;
  prefs.playerColor = colorChoice;
  prefs.elo = elo;
  openGame(tree.newGame({ playerColor, startFen: fen || null, elo }));
}

async function sharePgn(target) {
  const pgn = exportPgn(target);
  const stamp = new Date(target.createdAt).toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const file = new File([pgn], `xake-${stamp}.pgn`, { type: "application/x-chess-pgn" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: t("share.title") });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  const link = el("a", { href: URL.createObjectURL(file), download: file.name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function shareLink() {
  const url = gameToUrl(game);
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ url, title: t("share.title") });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(t("share.copied"));
  } catch {
    prompt(t("share.prompt"), url);
  }
}

// A shared link opens as a new game; the fragment is then dropped so a reload does not re-import it.
function readSharedGame() {
  if (!location.hash) return null;
  let out = null;
  try {
    out = gameFromHash(location.hash, prefs.elo);
  } catch (error) {
    toast(t("share.invalid", { error: error.message }));
  }
  history.replaceState(null, "", location.pathname + location.search);
  if (out) toast(t("share.opened"));
  return out;
}

function toggleBestMoves() {
  updatePrefs({ showBestMoves: !prefs.showBestMoves });
}

function toggleAnalysis() {
  updatePrefs({ showAnalysis: !prefs.showAnalysis });
}

// I take over Stockfish's colour and it takes over mine, from the displayed position (spec 002 §7).
function swapSides() {
  cancelEngine();
  game.playerColor = game.playerColor === "white" ? "black" : "white";
  orientation = game.playerColor;
  persist();
  render();
  maybeEngineMove();
  toast(t("swap.done", { side: sideName(game.playerColor) }));
}

function toggleTwoSides() {
  cancelEngine();
  game.twoSides = !game.twoSides;
  persist();
  render();
  maybeEngineMove();
  toast(t(game.twoSides ? "twoSides.on" : "twoSides.off"));
}

function flip() {
  orientation = orientation === "white" ? "black" : "white";
  render();
}

// ---- Sheets ----

function segmented(container, options, selected, onSelect) {
  container.replaceChildren();
  for (const [value, label] of options) {
    const button = el("button", { type: "button", textContent: label });
    button.setAttribute("aria-pressed", String(String(value) === String(selected)));
    button.onclick = () => onSelect(value);
    container.append(button);
  }
}

function updatePrefs(patch) {
  const before = prefs;
  prefs = { ...prefs, ...patch };
  storage.savePrefs(prefs);
  applyThemes(prefs);
  if (patch.language !== undefined) setLanguage(prefs.language);
  if (patch.coordinates !== undefined) {
    cg.set({ coordinates: prefs.coordinates });
    cg.redrawAll();
  }
  syncSettings();
  render();
  if (
    prefs.multipv !== before.multipv ||
    prefs.showAnalysis !== before.showAnalysis ||
    prefs.showBestMoves !== before.showBestMoves
  ) {
    scheduleAnalysis();
  }
}

function syncSettings() {
  $("elo-input").value = game.elo;
  $("elo-value").textContent = game.elo;
  $("coordinates-input").checked = prefs.coordinates;
  segmented($("multipv-input"), [1, 2, 3, 4, 5].map((v) => [v, String(v)]), prefs.multipv, (v) => updatePrefs({ multipv: v }));
  segmented($("language-input"), Object.entries(LANGUAGES), language(), (v) => updatePrefs({ language: v }));
  segmented(
    $("ui-theme-input"),
    UI_THEMES.map((key) => [key, t(`theme.${key}`)]),
    prefs.uiTheme,
    (v) => updatePrefs({ uiTheme: v }),
  );

  const swatches = $("board-theme-input");
  swatches.replaceChildren();
  for (const [key, theme] of Object.entries(BOARD_THEMES)) {
    const label = t(`board.${key}`);
    const button = el("button", { type: "button", title: label, ariaLabel: label });
    button.style.setProperty("--l", theme.light);
    button.style.setProperty("--d", theme.dark);
    button.setAttribute("aria-pressed", String(key === prefs.boardTheme));
    button.onclick = () => updatePrefs({ boardTheme: key });
    swatches.append(button);
  }

  const sets = $("piece-set-input");
  sets.replaceChildren();
  for (const [key, name] of Object.entries(PIECE_SETS)) {
    const label = key === "cburnett" ? t("pieces.cburnett") : name;
    const button = el("button", { type: "button", title: label, ariaLabel: label }, el("img", { src: pieceUrl(key, "white", "knight"), alt: "" }));
    button.setAttribute("aria-pressed", String(key === prefs.pieceSet));
    button.onclick = () => updatePrefs({ pieceSet: key });
    sets.append(button);
  }
}

function openSettings() {
  $("sheet-settings").showModal();
}

let newGameColor = prefs.playerColor;
function renderColorChoice() {
  for (const button of $("color-input").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.value === newGameColor));
  }
}

function openNewGame() {
  newGameColor = prefs.playerColor;
  renderColorChoice();
  $("new-elo-input").value = prefs.elo;
  $("new-elo-value").textContent = prefs.elo;
  $("sheet-new").showModal();
}

function renderGamesList() {
  const list = $("games-list");
  list.replaceChildren();
  for (const g of storage.listGames()) {
    const { plies, result } = tree.summary(g);
    const open = el("button", { className: "open" });
    const date = new Date(g.updatedAt).toLocaleString(language(), { dateStyle: "short", timeStyle: "short" });
    open.append(
      el("span", { textContent: t("games.title", { side: sideName(g.playerColor), elo: g.elo }) }),
      el("small", { textContent: t("games.summary", { date, moves: Math.ceil(plies / 2), result: result || t("games.ongoing") }) }),
    );
    open.onclick = () => {
      openGame(storage.loadGame(g.id) || g);
      $("sheet-games").close();
    };
    const share = el("button", { textContent: "⤓", title: t("games.export") });
    share.onclick = () => sharePgn(g);
    const remove = el("button", { textContent: "✕", title: t("bookmark.delete") });
    remove.onclick = () => {
      if (!confirm(t("games.confirmDelete"))) return;
      storage.deleteGame(g.id);
      if (g.id === game.id) openGame(tree.newGame({ playerColor: game.playerColor, elo: prefs.elo }));
      renderGamesList();
    };
    list.append(el("li", { className: g.id === game.id ? "current" : "" }, open, share, remove));
  }
}

// ---- Wiring ----

const SHORTCUTS = {
  ArrowLeft: () => step(-1),
  ArrowRight: () => step(1),
  ArrowUp: () => goTo(game.rootId),
  ArrowDown: () => goTo(tree.mainlineEnd(game, game.currentId).id),
  b: toggleBestMoves,
  " ": toggleBestMoves,
  a: toggleAnalysis,
  t: toggleTwoSides,
  c: swapSides,
  f: flip,
  u: undo,
  Backspace: undo,
  m: toggleBookmark,
  n: openNewGame,
  s: shareLink,
  "?": () => $("sheet-help").showModal(),
};

function bind() {
  $("btn-first").onclick = () => goTo(game.rootId);
  $("btn-prev").onclick = () => step(-1);
  $("btn-next").onclick = () => step(1);
  $("btn-last").onclick = () => goTo(tree.mainlineEnd(game, game.currentId).id);
  $("btn-undo").onclick = undo;
  $("btn-bookmark").onclick = toggleBookmark;
  $("btn-best").onclick = toggleBestMoves;
  $("btn-analysis").onclick = toggleAnalysis;
  $("btn-two-sides").onclick = toggleTwoSides;
  $("btn-swap").onclick = swapSides;

  $("moves").onclick = (event) => {
    const id = event.target.closest("[data-id]")?.dataset.id || event.target.closest(".cell")?.querySelector("[data-id]")?.dataset.id;
    if (id) goTo(id);
  };

  $("btn-settings").onclick = openSettings;
  $("btn-sound").onclick = () => updatePrefs({ sound: !prefs.sound });
  $("btn-new").onclick = openNewGame;
  $("btn-help").onclick = () => $("sheet-help").showModal();
  $("btn-games").onclick = () => {
    renderGamesList();
    $("sheet-games").showModal();
  };
  for (const dialog of document.querySelectorAll("dialog.sheet")) {
    dialog.querySelector("[data-close]").onclick = () => dialog.close();
    dialog.addEventListener("click", (event) => event.target === dialog && dialog.close());
  }

  $("elo-input").oninput = (event) => ($("elo-value").textContent = event.target.value);
  $("elo-input").onchange = (event) => {
    game.elo = Number(event.target.value);
    prefs.elo = game.elo;
    storage.savePrefs(prefs);
    persist();
    render();
  };
  $("new-elo-input").oninput = (event) => ($("new-elo-value").textContent = event.target.value);
  $("coordinates-input").onchange = (event) => updatePrefs({ coordinates: event.target.checked });

  $("color-input").onclick = (event) => {
    const value = event.target.closest("button")?.dataset.value;
    if (value) {
      newGameColor = value;
      renderColorChoice();
    }
  };
  $("new-game-form").onsubmit = (event) => {
    event.preventDefault();
    const fen = $("fen-input").value.trim();
    if (fen && !validateFen(fen).ok) return toast(t("fen.invalid", { error: validateFen(fen).error }));
    startNewGame(newGameColor, Number($("new-elo-input").value), fen);
    $("fen-input").value = "";
    $("sheet-new").close();
  };
  $("btn-export").onclick = () => sharePgn(game);
  $("btn-copy-link").onclick = shareLink;
  $("btn-share").onclick = shareLink;
  $("btn-copy-pgn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(exportPgn(game));
      toast(t("pgn.copied"));
    } catch {
      toast(t("pgn.copyFailed"));
    }
  };
  $("pgn-file").onchange = async (event) => {
    const file = event.target.files[0];
    if (file) $("pgn-input").value = await file.text();
  };
  $("btn-import").onclick = () => {
    try {
      openGame(importPgn($("pgn-input").value, prefs.elo));
      $("pgn-input").value = "";
      $("sheet-games").close();
      toast(t("pgn.imported"));
    } catch (error) {
      toast(t("pgn.invalid", { error: error.message }));
    }
  };

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || anyDialogOpen()) return;
    if (event.target.closest?.("input, textarea, select")) return;
    const action = SHORTCUTS[event.key.length === 1 ? event.key.toLowerCase() : event.key] || SHORTCUTS[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  });

  window.addEventListener("hashchange", () => {
    const shared = readSharedGame();
    if (shared) openGame(shared);
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => cg.redrawAll(), 100);
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register("sw.js").catch((error) => console.warn("service worker", error));
}

applyThemes(prefs);
setLanguage(prefs.language || serverDefault());
$("app-version").textContent = window.XAKE_CONFIG?.version ? `v${window.XAKE_CONFIG.version}` : "";
const shared = readSharedGame();
if (shared) {
  game = shared;
  orientation = game.playerColor;
  prefs.elo = game.elo;
}
bind();
sounds.unlockOnGesture();
syncSettings();
persist();
render();
scheduleAnalysis();
maybeEngineMove();
registerServiceWorker();
