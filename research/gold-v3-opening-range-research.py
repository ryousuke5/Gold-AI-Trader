"""GOLD V3 New York opening-range breakout research.

Fixed-rule, research-only study. Never places orders. Uses a chronological
development/holdout split and censors open trades at unverified data gaps.
See docs/GOLD_V3_ALTERNATIVE_STRATEGY_SCREEN_20261015.md for interpretation.
"""
import gzip, json, math, os, zipfile
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

DATA_FILE = os.getenv("GOLD_V3_ORB_DATA_FILE", "gold-xauusd-data/xauusd-m5.json.gz")
OUT_DIR = os.getenv("GOLD_V3_ORB_OUTPUT_DIR", "gold-v3-opening-range-output")
os.makedirs(OUT_DIR, exist_ok=True)
CUTOVER = pd.Timestamp("2024-10-06T00:00:00Z")
COSTS = {"baseline": (0.50, 0.05), "conservative": (0.75, 0.10)}
TARGET_R, MAX_HOLD = 1.5, 12

def load_bars(path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            with z.open("xauusd-m5.json.gz") as f:
                return json.loads(gzip.decompress(f.read()))
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)

def classify_gap(previous_ts, next_ts):
    delta = int(next_ts - previous_ts)
    if delta <= 900:
        return "small"
    p = datetime.fromtimestamp(int(previous_ts), tz=timezone.utc)
    n = datetime.fromtimestamp(int(next_ts), tz=timezone.utc)
    gap_start = int(previous_ts) + 300
    local = datetime.fromtimestamp(gap_start, tz=timezone.utc).astimezone(ZoneInfo("Europe/Nicosia"))
    offset = int(local.utcoffset().total_seconds() / 3600)
    minute = (gap_start // 60) % 1440
    rollover = (23 * 60 + 59 - offset * 60) % 1440
    distance = min(abs(minute - rollover), 1440 - abs(minute - rollover))
    if p.weekday() == 4 and n.weekday() == 6 and 46 * 3600 <= delta <= 54 * 3600:
        return "scheduled_weekend"
    if p.weekday() == n.weekday() and 0 <= p.weekday() <= 3 and 45 * 60 <= delta <= 90 * 60 and distance <= 10:
        return "scheduled_daily"
    return "unverified"

def simulate(candidate, arrays, spread, slippage):
    times, opens, highs, lows, closes = arrays
    i, entry_i, side, stop = candidate["i"], candidate["entry_i"], candidate["side"], candidate["stop"]
    entry = float(opens[entry_i] + spread + slippage if side == "BUY" else opens[entry_i] - slippage)
    distance = abs(entry - stop)
    if not math.isfinite(distance) or distance <= 0:
        return {"status": "rejected"}
    target = entry + TARGET_R * distance if side == "BUY" else entry - TARGET_R * distance
    end = min(len(times) - 1, entry_i + MAX_HOLD - 1)
    previous_i, exit_i, exit_price, reason = None, None, None, None
    for j in range(entry_i, end + 1):
        if previous_i is not None and int(times[j] - times[previous_i]) > 900:
            classification = classify_gap(times[previous_i], times[j])
            if classification not in ("scheduled_daily", "scheduled_weekend"):
                return {"status": "censored", "gap_class": classification, "censor_time_utc": pd.to_datetime(times[j], unit="s", utc=True).isoformat()}
            ask_open = opens[j] + spread
            stop_gap = (side == "BUY" and opens[j] <= stop) or (side == "SELL" and ask_open >= stop)
            target_gap = (side == "BUY" and opens[j] >= target) or (side == "SELL" and ask_open <= target)
            if stop_gap:
                exit_price = float(opens[j] - slippage if side == "BUY" else ask_open + slippage)
                reason, exit_i = "STOP_GAP", j
                break
            if target_gap:
                exit_price = float(target - slippage if side == "BUY" else target + spread + slippage)
                reason, exit_i = "TARGET_GAP", j
                break
        stop_hit = lows[j] <= stop if side == "BUY" else highs[j] + spread >= stop
        target_hit = highs[j] >= target if side == "BUY" else lows[j] + spread <= target
        if stop_hit:
            exit_price = float(stop - slippage if side == "BUY" else stop + spread + slippage)
            reason, exit_i = "STOP", j
            break
        if target_hit:
            exit_price = float(target - slippage if side == "BUY" else target + spread + slippage)
            reason, exit_i = "TARGET", j
            break
        previous_i = j
    if exit_i is None:
        exit_i = end
        exit_price = float(closes[end] - slippage if side == "BUY" else closes[end] + spread + slippage)
        reason = "TIME"
    net_r = (exit_price - entry) / distance if side == "BUY" else (entry - exit_price) / distance
    return {
        "status": "closed", "day": candidate["day"], "year": int(candidate["day"][:4]),
        "side": side, "signal_index": i, "entry_index": entry_i, "exit_index": int(exit_i),
        "signal_time_utc": candidate["signal_time_utc"], "ny_signal_time": candidate["ny_signal_time"],
        "entry_time_utc": pd.to_datetime(times[entry_i], unit="s", utc=True).isoformat(),
        "exit_time_utc": pd.to_datetime(times[exit_i], unit="s", utc=True).isoformat(),
        "entry": entry, "stop": stop, "target": target, "exit_price": exit_price,
        "risk_distance": distance, "range_atr": candidate["range_atr"], "net_r": float(net_r),
        "exit_reason": reason, "holding_bars": int(exit_i - entry_i + 1)
    }

def summarize(trades, start_equity=100000.0, risk_pct=0.25):
    equity, peak, max_dd, max_dd_pct = start_equity, start_equity, 0.0, 0.0
    gross_profit, gross_loss, sum_r = 0.0, 0.0, 0.0
    wins, losses, years = 0, 0, {}
    for t in trades:
        risk_cash = equity * risk_pct / 100.0
        pnl = risk_cash * t["net_r"]
        equity += pnl
        peak = max(peak, equity)
        dd = peak - equity
        max_dd = max(max_dd, dd)
        max_dd_pct = max(max_dd_pct, dd / peak * 100.0 if peak else 0.0)
        sum_r += t["net_r"]
        if pnl > 0:
            gross_profit += pnl
            wins += 1
        elif pnl < 0:
            gross_loss += -pnl
            losses += 1
        y = int(t["year"])
        row = years.setdefault(y, {"trades": 0, "wins": 0, "losses": 0, "total_R": 0.0})
        row["trades"] += 1
        row["wins"] += int(t["net_r"] > 0)
        row["losses"] += int(t["net_r"] < 0)
        row["total_R"] += t["net_r"]
    yearly = [{"year": y, **row, "expectancy_R": row["total_R"] / row["trades"]} for y, row in sorted(years.items())]
    n = len(trades)
    return {
        "trades": n, "wins": wins, "losses": losses, "win_rate_pct": 100 * wins / n if n else 0.0,
        "total_R": sum_r, "expectancy_R": sum_r / n if n else None,
        "profit_factor": gross_profit / gross_loss if gross_loss else (math.inf if gross_profit else 0.0),
        "net_profit": equity - start_equity, "return_pct": (equity / start_equity - 1) * 100,
        "max_drawdown_cash": max_dd, "max_drawdown_pct": max_dd_pct, "yearly": yearly
    }

def main():
    bars = load_bars(DATA_FILE)
    df = pd.DataFrame(bars)
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["time"] = pd.to_numeric(df["time"], errors="raise").astype("int64")
    df["dt"] = pd.to_datetime(df["time"], unit="s", utc=True)
    previous_close = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - previous_close).abs(), (df["low"] - previous_close).abs()], axis=1).max(axis=1)
    df["atr"] = tr.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    ny = df["dt"].dt.tz_convert("America/New_York")
    df["ny_date"] = ny.dt.strftime("%Y-%m-%d")
    df["ny_minute"] = ny.dt.hour * 60 + ny.dt.minute
    times = df["time"].to_numpy(dtype=np.int64)
    opens = df["open"].to_numpy(dtype=float)
    highs = df["high"].to_numpy(dtype=float)
    lows = df["low"].to_numpy(dtype=float)
    closes = df["close"].to_numpy(dtype=float)
    atrs = df["atr"].to_numpy(dtype=float)
    ny_dates = df["ny_date"].to_numpy()
    ny_minutes = df["ny_minute"].to_numpy(dtype=int)
    arrays = (times, opens, highs, lows, closes)

    candidates = []
    counts = {"dates_seen": 0, "missing_or_incomplete_opening_range": 0, "outside_range_width_gate": 0, "no_breakout_in_window": 0, "noncontiguous_entry": 0, "candidates": 0}
    for day, group in df.groupby("ny_date", sort=True):
        idx = group.index.to_numpy(dtype=np.int64)
        if not len(idx):
            continue
        counts["dates_seen"] += 1
        or_idx = idx[(ny_minutes[idx] >= 570) & (ny_minutes[idx] < 600)]
        if len(or_idx) != 6 or not np.all(np.diff(times[or_idx]) == 300):
            counts["missing_or_incomplete_opening_range"] += 1
            continue
        range_high, range_low = float(np.max(highs[or_idx])), float(np.min(lows[or_idx]))
        range_width = range_high - range_low
        if not math.isfinite(range_width) or range_width <= 0:
            counts["missing_or_incomplete_opening_range"] += 1
            continue
        session_idx = idx[(ny_minutes[idx] >= 600) & (ny_minutes[idx] < 660)]
        consumed = False
        found = None
        for i in session_idx:
            if i + 1 >= len(df) or int(times[i + 1] - times[i]) != 300:
                counts["noncontiguous_entry"] += 1
                continue
            atr = float(atrs[i])
            if not math.isfinite(atr) or atr <= 0:
                continue
            range_atr = range_width / atr
            body = closes[i] - opens[i]
            buy = closes[i] > range_high + 0.05 * atr and body > 0
            sell = closes[i] < range_low - 0.05 * atr and body < 0
            if not (buy or sell):
                continue
            if not 0.5 <= range_atr <= 2.5:
                counts["outside_range_width_gate"] += 1
                consumed = True
                break
            side = "BUY" if buy else "SELL"
            stop = range_low - 0.05 * atr if side == "BUY" else range_high + 0.05 * atr
            found = {"i": int(i), "entry_i": int(i + 1), "day": str(day), "side": side, "stop": float(stop),
                     "range_atr": float(range_atr), "signal_time_utc": df["dt"].iloc[i].isoformat(),
                     "ny_signal_time": str(ny.iloc[i])}
            break
        if found:
            candidates.append(found)
            counts["candidates"] += 1
        elif not consumed:
            counts["no_breakout_in_window"] += 1

    cutover = int(CUTOVER.timestamp())
    results = {
        "status": "RESEARCH_ONLY_FIXED_RULES",
        "data": {"bars": len(df), "first": df["dt"].iloc[0].isoformat(), "last": df["dt"].iloc[-1].isoformat(),
                 "provider": "Dukascopy Historical Data Feed", "resolution": "M5 BID", "session_timezone": "America/New_York"},
        "frozen_rules": {"opening_range_local": "09:30-10:00 America/New_York (six M5 bars)",
                         "signal_window_local": "10:00-11:00 America/New_York", "entry": "next M5 open; modeled spread/slippage",
                         "trigger": "first M5 close at least 0.05 ATR beyond opening-range boundary; candle direction agrees",
                         "stop": "opposite opening-range edge +/- 0.05 ATR", "range_width_atr_gate": [0.5, 2.5],
                         "target_R": TARGET_R, "max_hold_bars": MAX_HOLD, "one_attempt_per_New_York_date": True,
                         "same_bar_conflict": "stop first", "unverified_gap": "censor split; no fabricated exit",
                         "split_utc": CUTOVER.isoformat(), "threshold_sweep": False},
        "candidate_counts": counts, "total_candidates": len(candidates), "scenarios": {}
    }
    for cost_name, (spread, slip) in COSTS.items():
        results["scenarios"][cost_name] = {}
        for split, start, end in (("development", None, cutover), ("holdout", cutover, None), ("all_period", None, None)):
            rows, censor = [], None
            for cand in candidates:
                ts = int(times[cand["i"]])
                if start is not None and ts < start:
                    continue
                if end is not None and ts >= end:
                    continue
                outcome = simulate(cand, arrays, spread, slip)
                if outcome["status"] == "censored":
                    censor = {"signal_time_utc": cand["signal_time_utc"], "side": cand["side"],
                              "gap_class": outcome["gap_class"], "censor_time_utc": outcome["censor_time_utc"]}
                    break
                if outcome["status"] == "closed":
                    rows.append(outcome)
            summary = summarize(rows)
            results["scenarios"][cost_name][split] = {
                "spread": spread, "slippage": slip, "summary": summary, "censor": censor,
                "full_split_result_valid": censor is None,
                "interpretation": "Sequential one-position, fixed-rule test; historical Dukascopy M5 BID plus modeled costs, not actual XM execution."
            }
            pd.DataFrame(rows).to_csv(os.path.join(OUT_DIR, f"gold-v3-opening-range-{cost_name}-{split}.csv"), index=False)
    with open(os.path.join(OUT_DIR, "gold-v3-opening-range-development.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, allow_nan=False)
    print(json.dumps({
        "data": results["data"], "candidate_counts": counts,
        "summaries": {cost: {split: {
            "trades": val["summary"]["trades"], "expectancy_R": val["summary"]["expectancy_R"],
            "profit_factor": val["summary"]["profit_factor"], "return_pct": val["summary"]["return_pct"],
            "max_drawdown_pct": val["summary"]["max_drawdown_pct"], "censor": val["censor"]
        } for split, val in scenarios.items()} for cost, scenarios in results["scenarios"].items()}
    }, indent=2, allow_nan=False))

if __name__ == "__main__":
    main()
