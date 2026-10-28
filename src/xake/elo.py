"""Map a target Elo to Stockfish search options (spec §4)."""

import math
from dataclasses import dataclass, field

import chess.engine

MIN_ELO = 400
UCI_MIN_ELO = 1320
MAX_ELO = 3190

# Below UCI_MIN_ELO, Skill Level 0 is starved of nodes: log-interpolated between these bounds.
MIN_ELO_NODES = 20
UCI_MIN_ELO_NODES = 5000


@dataclass(frozen=True)
class PlayStrength:
    options: dict[str, chess.engine.ConfigValue] = field(default_factory=dict)
    nodes: int | None = None


def strength_for(elo: int) -> PlayStrength:
    if not MIN_ELO <= elo <= MAX_ELO:
        raise ValueError(f"elo must be within [{MIN_ELO}, {MAX_ELO}], got {elo}")
    if elo >= UCI_MIN_ELO:
        return PlayStrength(options={"UCI_LimitStrength": True, "UCI_Elo": elo})
    ratio = (elo - MIN_ELO) / (UCI_MIN_ELO - MIN_ELO)
    log_nodes = math.log(MIN_ELO_NODES) + ratio * (math.log(UCI_MIN_ELO_NODES) - math.log(MIN_ELO_NODES))
    return PlayStrength(options={"UCI_LimitStrength": False, "Skill Level": 0}, nodes=round(math.exp(log_nodes)))
