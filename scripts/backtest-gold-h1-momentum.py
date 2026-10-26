#!/usr/bin/env python3
"""Research-only GOLD H1 volatility-normalized momentum backtester.

Uses completed H1 bars aggregated from M5 BID OHLC. Signals are evaluated only
at completed H1 closes; entries occur at the following full H1 bar open. Exits
are simulated on M5 bars, with stop-first handling when both barriers are touched.
This is not an XM-native quote backtest: spread/slippage are explicit scenarios.
"""
from __future__ import annotations
import argparse
import bisect
import gzip
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

TIMEZONE = ZoneInfo("Europe/Nicosia")
SESSION_START_UTC = 7
SESSION_END_UTC = 20
STOP_ATR = 1.5
TARGET_R = 2.0
MAX_HOLD_H1 = 8
BAR_SECONDS = 300


def parse_utc(value: str) -> int:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.astimezone(timezone.utc).timestamp())


def load_m5(path: Path) -> list[dict]:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as f:
        rows = json.load(f)
    if not isinstance(rows, list):
        raise ValueError("M5 data must be a JSON array of objects")
    out = []
    seen = set()
    for row in rows:
        try:
            b = {
                "time": int(row["time"]),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row.get("volume", 0) or 0),
            }
        except (KeyError, TypeError, ValueError):
            continue
        if b["time"] in seen:
            continue
        if not all(math.isfinite(b[k]) for k in ("open", "high", "low", "close")):
            continue
        if b["open"] <= 0 or b["low"] <= 0 or b["high"] < b["low"] or b["high"] < max(b["open"], b["close"]) or b["low"] > min(b["open"], b["close"]):
            continue
        seen.add(b["time"])
        out.append(b)
    out.sort(key=lambda x: x["time"])
    if len(out) < 200_000:
        raise ValueError(f"Insufficient M5 history: {len(out)} bars")
    return out


def local_hour_start(ts: int) -> int:
    local = datetime.fromtimestamp(ts, timezone.utc).astimezone(TIMEZONE)
    bucket = local.replace(minute=0, second=0, microsecond=0)
    return int(bucket.timestamp())


def aggregate_h1(m5: list[dict]) -> list[dict]:
    groups: dict[int, list[dict]] = defaultdict(list)
    for b in m5:
        groups[local_hour_start(b["time"])].append(b)
    out = []
    for start, bars in sorted(groups.items()):
        bars.sort(key=lambda b: b["time"])
        expected = [start + i * BAR_SECONDS for i in range(12)]
        # Exclude partial/discontinuous hours rather than silently treating them as complete.
        if [b["time"] for b in bars] != expected:
            continue
        out.append({
            "time": start,
            "open": bars[0]["open"],
            "high": max(b["high"] for b in bars),
            "low": min(b["low"] for b in bars),
            "close": bars[-1]["close"],
            "volume": sum(b["volume"] for b in bars),
            "m5_start_index": None,
        })
    # Link complete H1 bar to the index of its first source M5 bar.
    index_by_time = {b["time"]: i for i, b in enumerate(m5)}
    for h in out:
        h["m5_start_index"] = index_by_time.get(h["time"])
    return out


def calc_atr14(h1: list[dict]) -> list[float | None]:
    tr = []
    for i, b in enumerate(h1):
        if i == 0:
            tr.append(b["high"] - b["low"])
        else:
            prev_close = h1[i - 1]["close"]
            tr.append(max(b["high"] - b["low"], abs(b["high"] - prev_close), abs(b["low"] - prev_close)))
    out: list[float | None] = [None] * len(h1)
    period = 14
    if len(h1) <= period:
        return out
    value = sum(tr[1:period + 1]) / period
    out[period] = value
    for i in range(period + 1, len(h1)):
        value = (value * (period - 1) + tr[i]) / period
        out[i] = value
    return out


def momentum_score(current_close: float, lookback_close: float, atr14: float, lookback: int) -> float:
    if lookback <= 0 or not math.isfinite(atr14) or atr14 <= 0:
        raise ValueError("lookback must be positive and ATR must be finite and positive")
    return (current_close - lookback_close) / (atr14 * math.sqrt(lookback))


def momentum_side(score: float, threshold: float) -> str | None:
    if score >= threshold:
        return "BUY"
    if score <= -threshold:
        return "SELL"
    return None


def metrics(trades: list[dict]) -> dict:
    n = len(trades)
    wins = [t["net_R"] for t in trades if t["net_R"] > 0]
    losses = [t["net_R"] for t in trades if t["net_R"] < 0]
    gross_win = sum(wins)
    gross_loss = -sum(losses)
    equity = peak = max_dd = 0.0
    for t in trades:
        equity += t["net_R"]
        peak = max(peak, equity)
        max_dd = max(max_dd, peak - equity)
    return {
        "trades": n,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate_pct": (len(wins) / n * 100) if n else 0.0,
        "profit_factor": (gross_win / gross_loss) if gross_loss > 0 else (999.0 if gross_win > 0 else 0.0),
        "expectancy_R": (sum(t["net_R"] for t in trades) / n) if n else 0.0,
        "net_R": sum(t["net_R"] for t in trades),
        "max_drawdown_R": max_dd,
        "gross_profit_R": gross_win,
        "gross_loss_R": gross_loss,
    }


def run_backtest(m5: list[dict], h1: list[dict], atrs: list[float | None],
                 *, lookback: int, threshold: float, start: int, end: int,
                 spread: float, slippage: float) -> tuple[list[dict], dict]:
    if lookback not in (4, 8, 12) or threshold not in (0.75, 1.0, 1.25):
        raise ValueError("Candidate must be one of the nine pre-registered combinations")
    m5_times = [b["time"] for b in m5]
    m5_by_time = {b["time"]: i for i, b in enumerate(m5)}
    eval_end_m5_index = bisect.bisect_left(m5_times, end)
    trades: list[dict] = []
    next_allowed_m5_index = -1
    for i in range(max(lookback, 14) + 1, len(h1) - 1):
        signal = h1[i]
        entry_bar = h1[i + 1]
        # Only eval signals in the named period; never let a trade enter at/after cutoff.
        if signal["time"] < start or signal["time"] >= end or entry_bar["time"] >= end:
            continue
        if entry_bar["time"] - signal["time"] != 3600:
            continue
        if atrs[i] is None or not math.isfinite(atrs[i]) or atrs[i] <= 0:
            continue
        hour_utc = datetime.fromtimestamp(signal["time"] + 3599, timezone.utc).hour
        if not (SESSION_START_UTC <= hour_utc <= SESSION_END_UTC):
            continue
        # Do not interpret a weekend/market-data gap as an N-hour momentum move.
        if any(h1[k]["time"] - h1[k - 1]["time"] != 3600 for k in range(i - lookback + 1, i + 1)):
            continue
        past_close = h1[i - lookback]["close"]
        momentum = momentum_score(signal["close"], past_close, atrs[i], lookback)
        side = momentum_side(momentum, threshold)
        if side is None:
            continue
        entry_idx = m5_by_time.get(entry_bar["time"])
        if entry_idx is None or entry_idx <= next_allowed_m5_index:
            continue
        entry_m5 = m5[entry_idx]
        entry_atr = float(atrs[i])
        risk_distance = STOP_ATR * entry_atr
        if side == "BUY":
            entry_price = entry_m5["open"] + spread + slippage
            stop = entry_price - risk_distance
            target = entry_price + TARGET_R * risk_distance
        else:
            entry_price = entry_m5["open"] - slippage
            stop = entry_price + risk_distance
            target = entry_price - TARGET_R * risk_distance

        last_idx = min(len(m5) - 1, entry_idx + MAX_HOLD_H1 * 12 - 1)
        # Restrict exit observations to the evaluation window, avoiding OOS leakage at the cutoff.
        last_idx = min(last_idx, eval_end_m5_index - 1)
        if last_idx < entry_idx:
            continue
        exit_idx = last_idx
        exit_reason = "time"
        if side == "BUY":
            for j in range(entry_idx, last_idx + 1):
                b = m5[j]
                if b["open"] <= stop:
                    exit_idx, exit_reason = j, "stop_gap"
                    break
                stop_hit = b["low"] <= stop
                target_hit = b["high"] >= target
                if stop_hit:
                    exit_idx, exit_reason = j, "stop"  # conservative stop-first if both touched
                    break
                if target_hit:
                    exit_idx, exit_reason = j, "target"
                    break
            exit_bar = m5[exit_idx]
            if exit_reason == "stop_gap":
                exit_price = exit_bar["open"] - slippage
            elif exit_reason == "stop":
                exit_price = stop - slippage
            elif exit_reason == "target":
                exit_price = target - slippage
            else:
                exit_price = exit_bar["close"] - slippage
            pnl = exit_price - entry_price
        else:
            for j in range(entry_idx, last_idx + 1):
                b = m5[j]
                ask_open = b["open"] + spread
                if ask_open >= stop:
                    exit_idx, exit_reason = j, "stop_gap"
                    break
                stop_hit = b["high"] + spread >= stop
                target_hit = b["low"] + spread <= target
                if stop_hit:
                    exit_idx, exit_reason = j, "stop"
                    break
                if target_hit:
                    exit_idx, exit_reason = j, "target"
                    break
            exit_bar = m5[exit_idx]
            if exit_reason == "stop_gap":
                exit_price = exit_bar["open"] + spread + slippage
            elif exit_reason == "stop":
                exit_price = stop + slippage
            elif exit_reason == "target":
                exit_price = target + slippage
            else:
                exit_price = exit_bar["close"] + spread + slippage
            pnl = entry_price - exit_price
        net_r = pnl / risk_distance
        exit_time = m5[exit_idx]["time"]
        trades.append({
            "side": side,
            "signal_time_utc": datetime.fromtimestamp(signal["time"] + 3599, timezone.utc).isoformat(),
            "entry_time_utc": datetime.fromtimestamp(entry_m5["time"], timezone.utc).isoformat(),
            "exit_time_utc": datetime.fromtimestamp(exit_time, timezone.utc).isoformat(),
            "momentum_score": momentum,
            "atr14_h1": entry_atr,
            "entry_price_model": entry_price,
            "exit_price_model": exit_price,
            "exit_reason": exit_reason,
            "risk_distance": risk_distance,
            "pnl_price_units_net": pnl,
            "net_R": net_r,
            "spread_price_assumption": spread,
            "slippage_each_side_assumption": slippage,
        })
        next_allowed_m5_index = exit_idx

    summary = metrics(trades)
    years = {}
    for t in trades:
        year = t["signal_time_utc"][:4]
        years.setdefault(year, []).append(t)
    summary["calendar_year_blocks"] = {year: metrics(block) for year, block in sorted(years.items())}
    period_start = datetime.fromtimestamp(start, timezone.utc)
    period_end = datetime.fromtimestamp(end, timezone.utc)
    annual_blocks = {}
    block_start = period_start
    block_number = 1
    while block_start < period_end:
        try:
            next_anniversary = block_start.replace(year=block_start.year + 1)
        except ValueError:  # defensive for leap-day starts
            next_anniversary = block_start.replace(month=2, day=28, year=block_start.year + 1)
        block_end = min(next_anniversary, period_end)
        block_trades = [t for t in trades if block_start.isoformat() <= t["signal_time_utc"] < block_end.isoformat()]
        label = f"block_{block_number}_{block_start.date()}_to_{block_end.date()}_exclusive"
        annual_blocks[label] = metrics(block_trades)
        block_start = block_end
        block_number += 1
    summary["predeclared_annual_blocks"] = annual_blocks
    summary["data_quality"] = {
        "m5_rows": len(m5),
        "complete_h1_rows": len(h1),
        "h1_rows_with_atr14": sum(x is not None for x in atrs),
        "data_source": "Dukascopy XAUUSD M5 BID; spread/slippage are modeled, not XM-native 5-year quote data",
    }
    summary["assumptions"] = {
        "timezone_for_h1_aggregation": "Europe/Nicosia",
        "session_utc_inclusive_hours": [SESSION_START_UTC, SESSION_END_UTC],
        "momentum_formula": "(close_t - close_t_minus_N) / (ATR14_H1 * sqrt(N))",
        "signal_uses_completed_h1_bar_only": True,
        "entry": "next consecutive complete H1 open (M5 open at H1 boundary)",
        "stop_atr": STOP_ATR,
        "target_R": TARGET_R,
        "max_holding_h1_bars": MAX_HOLD_H1,
        "intrabar_barrier_collision": "stop-first",
        "overlapping_positions": "disabled; next signal ignored until exit",
        "bid_only_cost_model": "BUY entry includes spread + slippage; SELL exit includes spread + slippage; slippage also adverse on the other side",
    }
    return trades, summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--lookback", required=True, type=int, choices=(4, 8, 12))
    ap.add_argument("--threshold", required=True, type=float, choices=(0.75, 1.0, 1.25))
    ap.add_argument("--spread", required=True, type=float)
    ap.add_argument("--slippage", required=True, type=float)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()
    start, end = parse_utc(args.start), parse_utc(args.end)
    if end <= start:
        ap.error("--end must be after --start")
    if args.spread < 0 or args.slippage < 0:
        ap.error("costs must be nonnegative")

    m5 = load_m5(args.data)
    h1 = aggregate_h1(m5)
    atrs = calc_atr14(h1)
    trades, summary = run_backtest(
        m5, h1, atrs, lookback=args.lookback, threshold=args.threshold,
        start=start, end=end, spread=args.spread, slippage=args.slippage,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "strategy_id": f"MOM_H1_N{args.lookback}_T{args.threshold:.2f}",
        "period": {"start_inclusive_utc": args.start, "end_exclusive_utc": args.end},
        "parameters": {"lookback_h1": args.lookback, "momentum_threshold": args.threshold,
                       "stop_atr": STOP_ATR, "target_R": TARGET_R, "max_holding_h1": MAX_HOLD_H1},
        "costs": {"spread_price": args.spread, "slippage_each_side_price": args.slippage},
        "summary": summary,
        "trades": trades,
    }
    args.out.write_text(json.dumps(payload, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({"strategy_id": payload["strategy_id"], "costs": payload["costs"], "summary": summary}, indent=2, allow_nan=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
