// UI theme, board palettes and piece sets; applied through CSS variables and a generated stylesheet.
// Labels are translated (i18n.js): theme.<key>, board.<key>, pieces.cburnett.
export const UI_THEMES = ["auto", "light", "dark"];

export const BOARD_THEMES = {
  brown: { light: "#f0d9b5", dark: "#b58863" },
  blue: { light: "#dee3e6", dark: "#8ca2ad" },
  green: { light: "#ffffdd", dark: "#86a666" },
  purple: { light: "#e8e0f0", dark: "#9f90b0" },
  grey: { light: "#d9d9d9", dark: "#a2a2a2" },
  night: { light: "#8c96a4", dark: "#4f5868" },
};

// Free licences only (vendor/pieces/COPYING.md): cburnett, merida GPLv2+; mpchess GPLv3+; pixel AGPLv3+.
export const PIECE_SETS = {
  cburnett: "Classic",
  merida: "Merida",
  mpchess: "MPChess",
  pixel: "Pixel",
};

const ROLES = { pawn: "P", knight: "N", bishop: "B", rook: "R", queen: "Q", king: "K" };

export const pieceUrl = (set, color, role) => `vendor/pieces/${set}/${color[0]}${ROLES[role]}.svg`;

export function applyThemes(prefs) {
  const root = document.documentElement;
  if (prefs.uiTheme === "auto") delete root.dataset.theme;
  else root.dataset.theme = prefs.uiTheme;

  const board = BOARD_THEMES[prefs.boardTheme] || BOARD_THEMES.brown;
  root.style.setProperty("--sq-light", board.light);
  root.style.setProperty("--sq-dark", board.dark);

  const set = PIECE_SETS[prefs.pieceSet] ? prefs.pieceSet : "cburnett";
  const rules = [];
  for (const color of ["white", "black"]) {
    for (const role of Object.keys(ROLES)) {
      rules.push(`.cg-wrap piece.${role}.${color}{background-image:url("${pieceUrl(set, color, role)}")}`);
    }
  }
  document.getElementById("piece-style").textContent = rules.join("\n");

  const bg = getComputedStyle(document.body).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg || "#161512");
}
