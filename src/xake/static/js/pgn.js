// PGN export (variations + bookmarks as comments) and main-line import (spec §7).
import { Chess } from "../vendor/chess.js/chess.js";
import { START_FEN, addBookmark, mainlineEnd, newGame, summary } from "./tree.js";

const BOOKMARK_PREFIX = "bookmark: ";

const escapeTag = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const escapeComment = (value) => String(value).replace(/[{}]/g, "");

function moveToken(game, n, forceNumber) {
  const [, turn, , , , number] = game.nodes[n.parent].fen.split(" ");
  const prefix = turn === "w" ? `${number}. ` : forceNumber ? `${number}... ` : "";
  return prefix + n.san;
}

function comments(game, n) {
  const out = game.bookmarks.filter((b) => b.nodeId === n.id).map((b) => `{${BOOKMARK_PREFIX}${escapeComment(b.label)}}`);
  if (n.by === "engine" && n.elo) out.push(`{elo ${n.elo}}`);
  return out;
}

function renderLine(game, from, out, forceNumber) {
  let n = game.nodes[from];
  let needNumber = forceNumber;
  while (n.children.length) {
    const [main, ...alternatives] = n.children.map((id) => game.nodes[id]);
    out.push(moveToken(game, main, needNumber), ...comments(game, main));
    needNumber = false;
    for (const alt of alternatives) {
      out.push("(" + moveToken(game, alt, true), ...comments(game, alt));
      renderLine(game, alt.id, out, false);
      out.push(")");
      needNumber = true;
    }
    n = main;
  }
}

export function exportPgn(game) {
  const { result } = summary(game);
  const pgnResult = result === "½-½" ? "1/2-1/2" : result || "*";
  const engine = `Stockfish (${game.elo})`;
  const tags = {
    Event: "xake",
    Date: new Date(game.createdAt).toISOString().slice(0, 10).replace(/-/g, "."),
    White: game.playerColor === "white" ? "Me" : engine,
    Black: game.playerColor === "black" ? "Me" : engine,
    Result: pgnResult,
  };
  if (game.startFen) Object.assign(tags, { SetUp: "1", FEN: game.startFen });
  const header = Object.entries(tags).map(([k, v]) => `[${k} "${escapeTag(v)}"]`);
  const tokens = [...game.bookmarks.filter((b) => b.nodeId === game.rootId).map((b) => `{${BOOKMARK_PREFIX}${b.label}}`)];
  renderLine(game, game.rootId, tokens, true);
  tokens.push(pgnResult);
  return `${header.join("\n")}\n\n${tokens.join(" ").replace(/\( /g, "(").replace(/ \)/g, ")")}\n`;
}

// Main line only: chess.js drops variations when loading a PGN.
export function importPgn(text, elo) {
  const chess = new Chess();
  chess.loadPgn(text);
  const headers = chess.getHeaders();
  const startFen = headers.FEN && headers.FEN !== START_FEN ? headers.FEN : null;
  const playerColor = headers.Black === "Me" ? "black" : "white";
  const game = newGame({ playerColor, startFen, elo });
  const fenToNode = new Map([[game.nodes.root.fen, game.rootId]]);
  let parentId = game.rootId;
  for (const move of chess.history({ verbose: true })) {
    const n = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
      parent: parentId,
      uci: move.from + move.to + (move.promotion || ""),
      san: move.san,
      fen: move.after,
      by: (move.color === "w") === (playerColor === "white") ? "me" : "engine",
      children: [],
    };
    game.nodes[n.id] = n;
    game.nodes[parentId].children.push(n.id);
    fenToNode.set(n.fen, n.id);
    parentId = n.id;
  }
  for (const { fen, comment } of chess.getComments()) {
    const nodeId = fenToNode.get(fen);
    if (nodeId && comment.startsWith(BOOKMARK_PREFIX)) addBookmark(game, nodeId, comment.slice(BOOKMARK_PREFIX.length));
  }
  game.currentId = mainlineEnd(game).id;
  return game;
}
