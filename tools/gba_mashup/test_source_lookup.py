"""Guard against reporting a caller's branch as recovered source code."""
import unittest
from tools.gba_mashup.component_lookup import definition_match


class SourceDefinitionTest(unittest.TestCase):
    def test_earlier_conditional_call_is_not_definition(self):
        source = '''static void Caller(void)
{
    if (Target(1)) { do_something(); }
    while (Target(2)) { do_something_else(); }
}
u8 Target(u8 value)
{
    return value;
}
'''
        match = definition_match(source, "Target")
        self.assertIsNotNone(match)
        self.assertTrue(match.group().startswith("u8 Target("))
        self.assertEqual(source.count("\n", 0, match.start()) + 1, 6)

    def test_calls_without_definition_remain_unproven(self):
        self.assertIsNone(definition_match("    if (Target(1)) { return 1; }", "Target"))

    def test_pointer_return_declaration(self):
        self.assertIsNotNone(definition_match("static const char *Target(void)\n{ return 0; }", "Target"))


if __name__ == "__main__":
    unittest.main()
