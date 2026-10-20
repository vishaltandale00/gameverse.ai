import unittest

from tools.prefab_pipeline.reward_strategy import lower_predicate


def field(name):
    return {"op": "field", "type": "u32", "name": name}


def value(n):
    return {"op": "const", "type": "u32", "value": n}


def compare(name, n):
    return {"op": "equal", "type": "bool", "args": [field(name), value(n)]}


class RewardStrategyTests(unittest.TestCase):
    def test_real_predicate_lowering_and_composition(self):
        self.assertEqual(lower_predicate(compare("owned_count", 0)), "(owned_count == 0u)")
        condition = {"op": "and", "type": "bool", "args": [compare("owned_count", 0), compare("soul_kind", 2)]}
        self.assertEqual(lower_predicate(condition), "((owned_count == 0u) && (d->soul_kind == 2u))")

    def test_opaque_field_and_code_injection_rejected(self):
        for name in ("raw_pointer", "owned_count);spawn()", "random"):
            with self.assertRaises(ValueError):
                lower_predicate(compare(name, 0))

    def test_type_and_bound_fail_closed(self):
        for condition in (field("owned_count"), compare("owned_count", -1), compare("owned_count", True),
                          {"op": "and", "type": "bool", "args": [field("species"), field("soul_kind")]}):
            with self.assertRaises(ValueError):
                lower_predicate(condition)

    def test_nested_unbounded_policy_rejected(self):
        condition = compare("owned_count", 0)
        for _ in range(20):
            condition = {"op": "or", "type": "bool", "args": [condition, compare("species", 1)]}
        with self.assertRaises(ValueError):
            lower_predicate(condition)


if __name__ == "__main__":
    unittest.main()
