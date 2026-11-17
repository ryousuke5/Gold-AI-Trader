-- Aggregate-only GOLD historical backtest reports.
-- This table stores summary metrics and configuration only; no candles or trade rows.
create table if not exists public.gold_backtest_runs (
  run_key text primary key check (run_key ~ '^[a-f0-9]{64}$'),
  source text not null check (source = 'NODE_HISTORICAL_ENGINE'),
  symbol text not null check (symbol ~ '^(XAUUSD|GOLD#?)$'),
  timeframe text not null check (timeframe = 'M5'),
  strategy_version text not null,
  evaluation_mode text not null,
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists gold_backtest_runs_strategy_period_idx
  on public.gold_backtest_runs (strategy_version, period_end desc);
create index if not exists gold_backtest_runs_created_at_idx
  on public.gold_backtest_runs (created_at desc);

alter table public.gold_backtest_runs enable row level security;
revoke all on table public.gold_backtest_runs from anon, authenticated, public;
grant all on table public.gold_backtest_runs to service_role;
