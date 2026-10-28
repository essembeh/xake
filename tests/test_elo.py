from pytest import mark, raises

from xake.elo import MAX_ELO, MIN_ELO, MIN_ELO_NODES, UCI_MIN_ELO, UCI_MIN_ELO_NODES, strength_for


@mark.parametrize("elo", [UCI_MIN_ELO, 2000, MAX_ELO])
def test_uci_elo_range(elo: int) -> None:
    strength = strength_for(elo)
    assert strength.options == {"UCI_LimitStrength": True, "UCI_Elo": elo}
    assert strength.nodes is None


def test_below_uci_range_uses_node_starved_skill_level() -> None:
    lowest = strength_for(MIN_ELO)
    assert lowest.options == {"UCI_LimitStrength": False, "Skill Level": 0}
    assert lowest.nodes == MIN_ELO_NODES
    assert MIN_ELO_NODES < (strength_for(UCI_MIN_ELO - 1).nodes or 0) <= UCI_MIN_ELO_NODES


def test_nodes_grow_with_elo() -> None:
    nodes = [strength_for(elo).nodes or 0 for elo in range(MIN_ELO, UCI_MIN_ELO, 100)]
    assert nodes == sorted(nodes)
    assert len(set(nodes)) == len(nodes)


@mark.parametrize("elo", [MIN_ELO - 1, MAX_ELO + 1])
def test_out_of_range(elo: int) -> None:
    with raises(ValueError):
        strength_for(elo)
