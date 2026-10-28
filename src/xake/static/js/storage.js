// localStorage persistence (spec §7); every access is guarded, storage may be unavailable.
const PREFIX = "xake:v1:";
const GAME_PREFIX = `${PREFIX}game:`;
const PREFS_KEY = `${PREFIX}prefs`;
const CURRENT_KEY = `${PREFIX}current`;

export const DEFAULT_PREFS = {
  // XAKE_DEFAULT_ELO, injected by /config.js; the level chosen afterwards is stored with the prefs.
  elo: window.XAKE_CONFIG?.defaultElo ?? 1500,
  multipv: 3,
  showAnalysis: true,
  showBestMoves: false,
  // null: the service default (XAKE_DEFAULT_LANGUAGE) until the user picks one.
  language: null,
  uiTheme: "auto",
  boardTheme: "brown",
  pieceSet: "cburnett",
  coordinates: true,
  sound: true,
  rageQuit: true,
  playerColor: "white",
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn("storage write failed", key, error);
    return false;
  }
}

export const loadPrefs = () => ({ ...DEFAULT_PREFS, ...read(PREFS_KEY, {}) });
export const savePrefs = (prefs) => write(PREFS_KEY, prefs);

// One key per game: saving a move never re-serializes the whole history.
export function saveGame(game) {
  game.updatedAt = Date.now();
  write(CURRENT_KEY, game.id);
  return write(GAME_PREFIX + game.id, game);
}

export const loadGame = (id) => read(GAME_PREFIX + id, null);

export function listGames() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(GAME_PREFIX)) {
        const game = read(key, null);
        if (game) out.push(game);
      }
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Leaves updatedAt and the current game alone: renaming does not reorder the list nor open the game.
export function renameGame(id, name) {
  const game = loadGame(id);
  if (!game) return false;
  if (name) game.name = name;
  else delete game.name;
  return write(GAME_PREFIX + id, game);
}

export function deleteGame(id) {
  try {
    localStorage.removeItem(GAME_PREFIX + id);
  } catch {
    // Storage unavailable: nothing to delete.
  }
}

export function loadCurrentGame() {
  const id = read(CURRENT_KEY, null);
  return id ? loadGame(id) : null;
}
