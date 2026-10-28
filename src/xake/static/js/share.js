// Game <-> URL fragment: `#c=w&e=1500&m=e2e4.e7e5.(d7d5.e4d5).g1f3[&f=<fen>]` (spec 002 §6).
import { START_FEN, addMove, mainlineEnd, newGame } from "./tree.js";

function serializeFrom(game, id, out) {
  let n = game.nodes[id];
  while (n.children.length) {
    const [main, ...alternatives] = n.children.map((childId) => game.nodes[childId]);
    out.push(main.uci);
    for (const alt of alternatives) {
      const inner = [alt.uci];
      serializeFrom(game, alt.id, inner);
      out.push(`(${inner.join(".")})`);
    }
    n = main;
  }
  return out;
}

export function gameToUrl(game) {
  const parts = [`c=${game.playerColor[0]}`, `e=${game.elo}`, `m=${serializeFrom(game, game.rootId, []).join(".")}`];
  if (game.startFen && game.startFen !== START_FEN) parts.push(`f=${encodeURIComponent(game.startFen)}`);
  return `${location.origin}${location.pathname}#${parts.join("&")}`;
}

function tokenize(text) {
  const out = [];
  let current = "";
  for (const ch of text) {
    if (ch === "." || ch === "(" || ch === ")") {
      if (current) out.push(current);
      current = "";
      if (ch !== ".") out.push(ch);
    } else {
      current += ch;
    }
  }
  if (current) out.push(current);
  return out;
}

// Returns a new game, null when the fragment holds no game; throws on an illegal move.
export function gameFromHash(hash, defaultElo) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (!params.has("m")) return null;
  const playerColor = params.get("c") === "b" ? "black" : "white";
  const elo = Number(params.get("e")) || defaultElo;
  const game = newGame({ playerColor, startFen: params.get("f") || null, elo });
  const stack = [];
  let parentId = game.rootId;
  let last = null;
  for (const token of tokenize(params.get("m"))) {
    if (token === "(") {
      if (!last) throw new Error("variation without a move");
      stack.push({ parentId, last });
      parentId = last.parent;
      last = null;
    } else if (token === ")") {
      if (!stack.length) throw new Error("unbalanced variation");
      ({ parentId, last } = stack.pop());
    } else {
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token)) throw new Error(`invalid move ${token}`);
      const turn = game.nodes[parentId].fen.split(" ")[1] === "w" ? "white" : "black";
      last = addMove(game, parentId, token, turn === playerColor ? "me" : "engine");
      parentId = last.id;
    }
  }
  game.currentId = mainlineEnd(game).id;
  return game;
}
