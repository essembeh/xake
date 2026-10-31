// Human-like opponent from 1100 to 1900 Elo: the Maia networks run by ONNX Runtime Web (spec 006).
import * as ort from "onnxruntime-web/wasm";
import { Chess } from "chess.js";
import { uciToMove } from "./tree.js";

// Same range as OPPONENTS.maia (engine.js): a shared link may still carry any Elo
const MIN_ELO = 1100;
const MAX_ELO = 1900;
const HISTORY = 8;
// Drawn among the moves at least this likely: varied games without the rare absurd move (spec 006 §4)
const MIN_PROBABILITY = 0.1;
const PIECES = ["p", "n", "b", "r", "q", "k"];
const FILES = "abcdefgh";

// Single-threaded: no cross-origin isolation needed (spec 005 §9)
ort.env.wasm.numThreads = 1;

// maia-1500 learnt from games between players rated 1500 to 1599
const modelFile = (elo) => `maia/maia-${Math.floor(Math.min(MAX_ELO, Math.max(MIN_ELO, elo)) / 100) * 100}.onnx`;

// lc0 policy vocabulary: queen-like and knight moves by origin then target square, then under-promotions to q/r/b
// (a plain promotion move means a knight), always from the side to move's point of view.
const POLICY_INDEX = (() => {
  const out = new Map();
  const name = (sq) => FILES[sq % 8] + (Math.floor(sq / 8) + 1);
  for (let from = 0; from < 64; from++) {
    for (let to = 0; to < 64; to++) {
      const dx = Math.abs((to % 8) - (from % 8));
      const dy = Math.abs(Math.floor(to / 8) - Math.floor(from / 8));
      if (from !== to && (dx === 0 || dy === 0 || dx === dy || dx * dy === 2)) out.set(name(from) + name(to), out.size);
    }
  }
  for (let file = 0; file < 8; file++) {
    for (const target of [file - 1, file, file + 1].filter((f) => f >= 0 && f < 8)) {
      for (const piece of "qrb") out.set(`${FILES[file]}7${FILES[target]}8${piece}`, out.size);
    }
  }
  return out;
})();

const sessions = new Map();
export const preload = (elo) => session(modelFile(elo));
function session(file) {
  if (!sessions.has(file)) {
    const loading = ort.InferenceSession.create(file, { executionProviders: ["wasm"] });
    // A failed download must not stay cached
    loading.catch(() => sessions.delete(file));
    sessions.set(file, loading);
  }
  return sessions.get(file);
}

const flipRank = (square) => square[0] + (9 - Number(square[1]));

// The side to move always plays "up": ranks are mirrored for Black.
function policyKey(move, flip) {
  let to = move.to;
  // lc0 encodes castling as the king taking its own rook
  if (move.flags.includes("k")) to = `h${move.to[1]}`;
  if (move.flags.includes("q")) to = `a${move.to[1]}`;
  const from = flip ? flipRank(move.from) : move.from;
  if (flip) to = flipRank(to);
  const promotion = move.promotion && move.promotion !== "n" ? move.promotion : "";
  return from + to + promotion;
}

// lc0 classical input: 8 positions × (6 own + 6 opponent piece planes + repetition), then castling,
// side to move, 50-move counter and a plane of ones.
function encode({ start_fen: startFen, moves }) {
  const chess = startFen ? new Chess(startFen) : new Chess();
  const seen = new Map();
  const snapshot = () => {
    const key = chess.fen().split(" ").slice(0, 4).join(" ");
    seen.set(key, (seen.get(key) || 0) + 1);
    return { board: chess.board(), repeated: seen.get(key) > 1 };
  };
  const history = [snapshot()];
  for (const uci of moves) {
    chess.move(uciToMove(uci));
    history.push(snapshot());
  }
  const us = chess.turn();
  const flip = us === "b";
  const planes = new Float32Array(112 * 64);
  history
    .slice(-HISTORY)
    .reverse()
    .forEach(({ board, repeated }, step) => {
      const base = step * 13 * 64;
      board.forEach((row, r) => {
        row.forEach((piece, file) => {
          if (!piece) return;
          const rank = 7 - r;
          const square = (flip ? 7 - rank : rank) * 8 + file;
          const plane = (piece.color === us ? 0 : 6) + PIECES.indexOf(piece.type);
          planes[base + plane * 64 + square] = 1;
        });
      });
      if (repeated) planes.fill(1, base + 12 * 64, base + 13 * 64);
    });
  const them = us === "w" ? "b" : "w";
  const fill = (plane, value) => planes.fill(value, plane * 64, (plane + 1) * 64);
  const ours = chess.getCastlingRights(us);
  const theirs = chess.getCastlingRights(them);
  fill(104, ours.q ? 1 : 0);
  fill(105, ours.k ? 1 : 0);
  fill(106, theirs.q ? 1 : 0);
  fill(107, theirs.k ? 1 : 0);
  fill(108, flip ? 1 : 0);
  fill(109, Number(chess.fen().split(" ")[4]));
  fill(111, 1);
  return { chess, flip, planes };
}

// A human move drawn from the network's probabilities over the legal moves (no search).
export async function move(position, elo, signal) {
  const net = await session(modelFile(elo));
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const { chess, flip, planes } = encode(position);
  const outputs = await net.run({ "/input/planes": new ort.Tensor("float32", planes, [1, 112, 8, 8]) });
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const policy = outputs["/output/policy"].data;
  const candidates = chess.moves({ verbose: true }).map((candidate) => ({
    candidate,
    logit: policy[POLICY_INDEX.get(policyKey(candidate, flip))],
  }));
  if (!candidates.length) return null;
  const top = Math.max(...candidates.map((c) => c.logit));
  for (const c of candidates) c.weight = Math.exp(c.logit - top);
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  // The most likely move always passes the threshold: never an empty draw
  const kept = candidates.filter((c) => c.weight / total >= MIN_PROBABILITY || c.weight === 1);
  let draw = Math.random() * kept.reduce((sum, c) => sum + c.weight, 0);
  const picked = kept.find((c) => (draw -= c.weight) <= 0) ?? kept[0];
  const { from, to, promotion, san } = picked.candidate;
  return { uci: from + to + (promotion || ""), san };
}
