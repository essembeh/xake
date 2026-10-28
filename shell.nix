{
  pkgs ? import <nixpkgs> { },
}:
pkgs.mkShell {
  packages = [
    pkgs.uv
    pkgs.just
    pkgs.stockfish
  ];
}
