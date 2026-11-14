-- Research-only GOLD Forward/Paper loss telemetry.
-- Apply only to the dedicated research Supabase project, never production by default.

create table if not exists public.gold_forward_research_observations (
  id uuid primary key default gen_random_uuid(),
  observation_key text not null unique,
  signal_id uuid not null unique references public.gold_ai_signals(id) on delete cascade,
  symbol text not null,
  timeframe text not null default 'M5',
  strategy_version text not null,
  side text not null check (side in ('BUY','SELL')),
  signal_bar_time timestamptz not null,
  entry_reference numeric not null,
  stop_loss numeric not null,
  take_profit numeric not null,
  risk_distance numeric not null check (risk_distance > 0),
  entry_atr numeric,
  entry_spread numeric,
  setup_type text,
  setup_reason text,
  entry_context jsonb not null default '{}'::jsonb,
  h1_context jsonb not null default '{}'::jsonb,
  m5_context jsonb not null default '{}'::jsonb,
  outcome_15m jsonb,
  outcome_30m jsonb,
  status text not null default 'PENDING'
    check (status in ('PENDING','COMPLETED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists gold_forward_research_pending_idx
  on public.gold_forward_research_observations(symbol, status, signal_bar_time desc);
create index if not exists gold_forward_research_strategy_time_idx
  on public.gold_forward_research_observations(strategy_version, signal_bar_time desc);

alter table public.gold_forward_research_observations enable row level security;
revoke all on table public.gold_forward_research_observations from anon, authenticated, public;
grant all on table public.gold_forward_research_observations to service_role;

comment on table public.gold_forward_research_observations is
  'Non-executable forward/paper diagnostic observations. No orders are created by this table.';
