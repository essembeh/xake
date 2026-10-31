// Game = tree of moves; first child is the main line, others are variations (spec §6.5).
import { Chess } from "chess.js";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(".", ""));

export function newGame({ playerColor, startFen = null, elo, opponent = "stockfish" }) {
  const now = Date.now();
  const root = { id: "root", parent: null, uci: null, san: null, fen: startFen || START_FEN, by: null, children: [] };
  return {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    playerColor,
    startFen,
    elo,
    // "stockfish" or "maia" (spec 006); games saved before have none: Stockfish
    opponent,
    twoSides: false,
    nodes: { root },
    rootId: "root",
    currentId: "root",
    bookmarks: [],
  };
}

export const node = (game, id) => game.nodes[id];
export const current = (game) => game.nodes[game.currentId];

// Nodes from the first move down to `id`, root excluded.
export function path(game, id) {
  const out = [];
  for (let n = game.nodes[id]; n && n.parent !== null; n = game.nodes[n.parent]) out.push(n);
  return out.reverse();
}

export const ucis = (game, id) => path(game, id).map((n) => n.uci);

// Replays from the start so that repetitions and the 50-move rule are known.
export function chessAt(game, id) {
  const out = new Chess(game.startFen || START_FEN);
  for (const n of path(game, id)) out.move(uciToMove(n.uci));
  return out;
}

export function uciToMove(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
}

// Plays `uci` from `parentId`; reuses an existing child with the same move.
export function addMove(game, parentId, uci, by, extra = {}) {
  const parent = game.nodes[parentId];
  const existing = parent.children.map((id) => game.nodes[id]).find((n) => n.uci === uci);
  if (existing) return existing;
  const chess = chessAt(game, parentId);
  const move = chess.move(uciToMove(uci));
  const out = { id: uid(), parent: parentId, uci, san: move.san, fen: chess.fen(), by, children: [], ...extra };
  game.nodes[out.id] = out;
  parent.children.push(out.id);
  return out;
}

export function mainlineEnd(game, id = game.rootId) {
  let n = game.nodes[id];
  while (n.children.length) n = game.nodes[n.children[0]];
  return n;
}

export function isAncestor(game, ancestorId, id) {
  for (let n = game.nodes[id]; n; n = game.nodes[n.parent]) if (n.id === ancestorId) return true;
  return false;
}

// Detaches the subtree rooted at `id`; returns what restoreSubtree needs.
export function removeSubtree(game, id) {
  const top = game.nodes[id];
  const parent = game.nodes[top.parent];
  const index = parent.children.indexOf(id);
  parent.children.splice(index, 1);
  const removed = [];
  const stack = [id];
  while (stack.length) {
    const n = game.nodes[stack.pop()];
    removed.push(n);
    stack.push(...n.children);
    delete game.nodes[n.id];
  }
  const ids = new Set(removed.map((n) => n.id));
  const bookmarks = game.bookmarks.filter((b) => ids.has(b.nodeId));
  game.bookmarks = game.bookmarks.filter((b) => !ids.has(b.nodeId));
  return { parentId: parent.id, index, removed, bookmarks };
}

export function restoreSubtree(game, snapshot) {
  for (const n of snapshot.removed) game.nodes[n.id] = n;
  game.nodes[snapshot.parentId].children.splice(snapshot.index, 0, snapshot.removed[0].id);
  game.bookmarks.push(...snapshot.bookmarks);
}

// True when `id` is a leaf reached from `ancestorId` without any branching on the way.
export function isBareChain(game, ancestorId, id) {
  if (game.nodes[id].children.length) return false;
  for (let n = game.nodes[id]; n.parent !== ancestorId; n = game.nodes[n.parent]) {
    if (n.parent === null) return false;
    if (game.nodes[n.parent].children.length > 1) return false;
  }
  return true;
}

export function moveLabel(game, n) {
  const fen = game.nodes[n.parent].fen.split(" ");
  return fen[1] === "w" ? `${fen[5]}. ${n.san}` : `${fen[5]}… ${n.san}`;
}

export function addBookmark(game, nodeId, label) {
  const out = { id: uid(), nodeId, label };
  game.bookmarks.push(out);
  return out;
}

export function summary(game) {
  const end = mainlineEnd(game);
  const chess = chessAt(game, end.id);
  let result = null;
  if (chess.isCheckmate()) result = chess.turn() === "w" ? "0-1" : "1-0";
  else if (chess.isDraw() || chess.isStalemate()) result = "½-½";
  return { plies: path(game, end.id).length, result };
}
