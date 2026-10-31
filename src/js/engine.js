// Stockfish in the browser (spec 005): opponent moves and analysis, from Web Workers.
import { Chess } from "chess.js";
import { gameEnding } from "./evaluation.js";
import { uciToMove } from "./tree.js";

export const ENGINE_FILES = ["stockfish/stockfish-19-lite-single.js", "stockfish/stockfish-19-lite-single.wasm"];
const ENGINE_URL = ENGINE_FILES[0];
const config = window.XAKE_CONFIG || {};
const PLAY_MOVETIME_MS = config.playMovetimeMs ?? 300;
// Node budgets (spec 005 §9): the same answer in every browser; the time cap bounds slow devices.
const ANALYSIS = { nodes: 1_000_000, capMs: 2000 };
const TIMELINE = { nodes: 300_000, capMs: 500 };
const HASH_MB = 32;
// A search that outlives its movetime by this much is a hung worker: it is replaced.
const HANG_MARGIN_MS = 5000;
// The first start downloads the 1.8 MB wasm, possibly over a slow mobile network.
const START_TIMEOUT_MS = 60_000;

// Elo to UCI options (spec 001 §4); the Elo bounds are also checked by XAKE_DEFAULT_ELO.
const UCI_MIN_ELO = 1320;
const MIN_ELO = 400;
const MIN_ELO_NODES = 20;
const UCI_MIN_ELO_NODES = 5000;

function strengthFor(elo) {
  if (elo >= UCI_MIN_ELO) return { options: { UCI_LimitStrength: true, UCI_Elo: elo, "Skill Level": 20 }, nodes: null };
  const ratio = (elo - MIN_ELO) / (UCI_MIN_ELO - MIN_ELO);
  const logNodes = Math.log(MIN_ELO_NODES) + ratio * (Math.log(UCI_MIN_ELO_NODES) - Math.log(MIN_ELO_NODES));
  return { options: { UCI_LimitStrength: false, "Skill Level": 0 }, nodes: Math.round(Math.exp(logNodes)) };
}

export class EngineError extends Error {}

const abortError = () => new DOMException("aborted", "AbortError");
export const isAbort = (error) => error?.name === "AbortError";

// One engine process: a Web Worker speaking UCI over postMessage, one search at a time.
class EngineWorker {
  constructor() {
    this.dead = false;
    this.listener = null;
    this.worker = new Worker(ENGINE_URL);
    this.worker.onmessage = (event) => this.listener?.(String(event.data));
    this.worker.onerror = (event) => {
      event.preventDefault?.();
      this.kill(`engine crashed: ${event.message || "worker error"}`);
    };
  }

  kill(reason) {
    if (this.dead) return;
    this.dead = true;
    this.worker.terminate();
    this.onDeath?.(new EngineError(reason));
  }

  // Sends the commands and resolves with the first line matching `until`; other lines go to onLine.
  exchange(commands, until, { onLine = null, timeoutMs = 10_000 } = {}) {
    return new Promise((resolve, reject) => {
      // A hidden page may have been suspended (mobile background): give it time again
      const expire = () => (document.hidden ? (timer = setTimeout(expire, timeoutMs)) : this.kill("engine timed out"));
      let timer = setTimeout(expire, timeoutMs);
      this.onDeath = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      this.listener = (line) => {
        if (until.test(line)) {
          clearTimeout(timer);
          this.listener = this.onDeath = null;
          resolve(line);
        } else {
          onLine?.(line);
        }
      };
      for (const command of commands) this.worker.postMessage(command);
    });
  }

  async start() {
    await this.exchange(["uci"], /^uciok/, { timeoutMs: START_TIMEOUT_MS });
    await this.exchange([`setoption name Hash value ${HASH_MB}`, "isready"], /^readyok/);
  }

  // Runs `go`; on abort, stops the search and still waits for bestmove so the worker stays in sync.
  async search(setup, go, movetimeMs, signal, onInfo) {
    const onAbort = () => this.worker.postMessage("stop");
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const line = await this.exchange([...setup, go], /^bestmove/, {
        onLine: (l) => l.startsWith("info ") && onInfo?.(l),
        timeoutMs: movetimeMs + HANG_MARGIN_MS,
      });
      if (signal?.aborted) throw abortError();
      return line.split(/\s+/)[1];
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

// Fixed-size pool of workers, created on first use: one search per worker at a time.
class EnginePool {
  constructor(size) {
    this.size = size;
    this.count = 0;
    this.idle = [];
    this.waiters = [];
  }

  async acquire(signal) {
    if (signal?.aborted) throw abortError();
    if (this.idle.length) return this.idle.pop();
    if (this.count < this.size) {
      this.count++;
      const engine = new EngineWorker();
      try {
        await engine.start();
      } catch (error) {
        this.count--;
        engine.kill("engine failed to start");
        throw error instanceof EngineError ? error : new EngineError(String(error));
      }
      return engine;
    }
    // Resolves with a worker, or null when a dead one freed its slot: the caller acquires again
    const engine = await new Promise((resolve) => this.waiters.push(resolve));
    if (signal?.aborted) {
      if (engine) this.release(engine);
      else this.waiters.shift()?.(null);
      throw abortError();
    }
    return engine;
  }

  release(engine) {
    if (engine.dead) {
      this.count--;
      // A waiter takes the free slot and spawns a fresh worker
      this.waiters.shift()?.(null);
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) waiter(engine);
    else this.idle.push(engine);
  }

  async run(signal, task) {
    let engine = await this.acquire(signal);
    while (engine === null) engine = await this.acquire(signal);
    try {
      return await task(engine);
    } finally {
      this.release(engine);
    }
  }
}

const pools = { play: new EnginePool(1), analyse: new EnginePool(2) };

// The whole history is replayed: repetitions and the 50-move rule need it.
function boardOf({ start_fen: startFen, moves }) {
  const out = startFen ? new Chess(startFen) : new Chess();
  try {
    for (const uci of moves) out.move(uciToMove(uci));
  } catch (error) {
    throw new EngineError(`illegal position: ${error}`);
  }
  return out;
}

// Same endings as the board shows (spec 005 §11).
function outcomeOf(chess) {
  const ending = gameEnding(chess);
  if (!ending) return null;
  const result = ending.winner ? (ending.winner === "white" ? "1-0" : "0-1") : "1/2-1/2";
  return { result, termination: ending.termination };
}

function positionCommand({ start_fen: startFen, moves }) {
  const base = startFen ? `position fen ${startFen}` : "position startpos";
  return moves.length ? `${base} moves ${moves.join(" ")}` : base;
}

const setOptions = (options) => Object.entries(options).map(([name, value]) => `setoption name ${name} value ${value}`);

const sanOf = (chess, uci) => new Chess(chess.fen()).move(uciToMove(uci)).san;

// The player picks the opponent of a game (spec 006): Stockfish held back by Elo, or Maia, one
// network per 100 points of Lichess rating, playing like a human of that level.
export const OPPONENTS = {
  stockfish: { name: "Stockfish", minElo: 400, maxElo: 3190, step: 10 },
  maia: { name: "Maia", minElo: 1100, maxElo: 1900, step: 100 },
};

export function snapElo(elo, opponent) {
  const { minElo, maxElo, step } = OPPONENTS[opponent] ?? OPPONENTS.stockfish;
  return Math.min(maxElo, Math.max(minElo, Math.floor(elo / step) * step));
}

// Loaded on demand: ONNX Runtime and the networks are only fetched for a Maia game.
let maia = null;
const loadMaia = () =>
  (maia ??= import("./maia.js").catch((error) => {
    maia = null;
    throw error;
  }));

// Downloads the network of this level (then cached by the service worker) before the game starts.
export async function preloadMaia(elo) {
  try {
    await (await loadMaia()).preload(elo);
  } catch (error) {
    throw new EngineError(`Maia unavailable: ${error}`);
  }
}

export async function engineMove(position, elo, signal, opponent = "stockfish") {
  const board = boardOf(position);
  if (outcomeOf(board)) throw new EngineError("game is over");
  if (opponent !== "maia") return stockfishMove(board, position, elo, signal);
  let out;
  try {
    out = await (await loadMaia()).move(position, elo, signal);
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new EngineError(`Maia unavailable: ${error}`);
  }
  if (!out) throw new EngineError("game is over");
  return out;
}

async function stockfishMove(board, position, elo, signal) {
  const { options, nodes } = strengthFor(elo);
  const go = `go movetime ${PLAY_MOVETIME_MS}${nodes ? ` nodes ${nodes}` : ""}`;
  const uci = await pools.play.run(signal, (engine) =>
    engine.search([...setOptions(options), positionCommand(position)], go, PLAY_MOVETIME_MS, signal),
  );
  if (!uci || uci === "(none)") throw new EngineError("game is over");
  return { uci, san: sanOf(board, uci) };
}

function parseInfo(line) {
  const tokens = line.split(/\s+/);
  const out = { multipv: 1, bound: false };
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "depth") out.depth = Number(tokens[++i]);
    else if (token === "multipv") out.multipv = Number(tokens[++i]);
    else if (token === "score") {
      const kind = tokens[++i];
      out.score = { kind, value: Number(tokens[++i]) };
    } else if (token === "lowerbound" || token === "upperbound") out.bound = true;
    else if (token === "pv") {
      out.pv = tokens.slice(i + 1);
      break;
    }
  }
  return out;
}

// Exact infos of the deepest complete depth: bound infos carry a truncated PV (spec 001 §2).
function deepestComplete(byDepth, expected) {
  const depths = [...byDepth.keys()].sort((a, b) => b - a);
  const ranked = (depth) => [...byDepth.get(depth).entries()].sort(([a], [b]) => a - b).map(([, info]) => info);
  for (const depth of depths) {
    const infos = ranked(depth);
    if (infos.length >= expected && new Set(infos.map((info) => info.pv[0])).size === infos.length) return infos;
  }
  if (!depths.length) return [];
  const out = [];
  for (const info of ranked(depths[0])) if (out.every((kept) => kept.pv[0] !== info.pv[0])) out.push(info);
  return out;
}

function toLine(chess, info) {
  if (!info.pv?.length || !info.score) return null;
  // UCI scores are from the side to move; the app always speaks from White's point of view
  const sign = chess.turn() === "w" ? 1 : -1;
  const value = sign * info.score.value;
  const score = info.score.kind === "mate" ? { cp: null, mate: value } : { cp: value, mate: null };
  const replay = new Chess(chess.fen());
  const pvSan = [];
  for (const uci of info.pv) {
    try {
      pvSan.push(replay.move(uciToMove(uci)).san);
    } catch {
      break;
    }
  }
  if (!pvSan.length) return null;
  return { uci: info.pv[0], san: pvSan[0], score, pv_san: pvSan };
}

export async function analyse(position, multipv, signal, { timeline = false } = {}) {
  const board = boardOf(position);
  const outcome = outcomeOf(board);
  if (outcome) return { score: null, depth: 0, lines: [], outcome };
  const { nodes, capMs } = timeline ? TIMELINE : ANALYSIS;
  const byDepth = new Map();
  const onInfo = (line) => {
    const info = parseInfo(line);
    if (!info.pv || !info.depth || info.bound) return;
    if (!byDepth.has(info.depth)) byDepth.set(info.depth, new Map());
    byDepth.get(info.depth).set(info.multipv, info);
  };
  await pools.analyse.run(signal, (engine) =>
    engine.search(
      [...setOptions({ MultiPV: multipv }), positionCommand(position)],
      `go nodes ${nodes} movetime ${capMs}`,
      capMs,
      signal,
      onInfo,
    ),
  );
  const infos = deepestComplete(byDepth, Math.min(multipv, board.moves().length));
  const lines = infos.map((info) => toLine(board, info)).filter(Boolean);
  return {
    score: lines[0]?.score ?? null,
    depth: Math.max(0, ...infos.map((info) => info.depth)),
    lines,
    outcome: null,
  };
}
