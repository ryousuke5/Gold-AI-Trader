import importlib.util
import json
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "backtest-gold-h1-momentum.py"
spec = importlib.util.spec_from_file_location("gold_h1_momentum", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class MomentumResearchTests(unittest.TestCase):
    def test_formula_is_volatility_normalized(self):
        self.assertAlmostEqual(mod.momentum_score(110, 100, 2, 4), 2.5)
        self.assertAlmostEqual(mod.momentum_score(90, 100, 2, 4), -2.5)

    def test_direction_has_symmetric_threshold(self):
        self.assertEqual(mod.momentum_side(0.75, 0.75), "BUY")
        self.assertEqual(mod.momentum_side(-1.25, 1.25), "SELL")
        self.assertIsNone(mod.momentum_side(0.749, 0.75))
        self.assertIsNone(mod.momentum_side(-0.749, 0.75))

    def test_invalid_atr_fails_closed(self):
        with self.assertRaises(ValueError):
            mod.momentum_score(101, 100, 0, 4)

    def test_pre_registered_grid_is_nine_unique_combinations(self):
        config = json.loads((SCRIPT.parents[1] / "config" / "gold-h1-momentum-candidates.json").read_text())
        self.assertEqual(len(config), 9)
        combos = {(c["lookback_h1"], c["momentum_threshold"]) for c in config}
        self.assertEqual(len(combos), 9)
        self.assertEqual({c["lookback_h1"] for c in config}, {4, 8, 12})
        self.assertEqual({c["momentum_threshold"] for c in config}, {0.75, 1.0, 1.25})

    def test_h1_aggregation_discards_partial_hours(self):
        from datetime import datetime, timezone
        start = int(datetime(2024, 10, 10, 0, 0, tzinfo=timezone.utc).timestamp())
        bars = []
        for i in range(13 * 12):
            t = start + i * 300
            p = 2000 + i * 0.01
            bars.append({"time":t,"open":p,"high":p+0.4,"low":p-0.3,"close":p+0.05,"volume":1})
        h1 = mod.aggregate_h1(bars)
        self.assertTrue(len(h1) >= 12)
        self.assertTrue(all(h["m5_start_index"] is not None for h in h1))
        self.assertTrue(all(h1[i+1]["time"] - h1[i]["time"] == 3600 for i in range(len(h1)-1)))

if __name__ == "__main__":
    unittest.main()
