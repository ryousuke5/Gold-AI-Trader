-- Gold AI Trader V1 schema
-- Intended for the separate Supabase project: Gold-AI-Trader.
-- Server-side access only: anon/authenticated are explicitly revoked.

create extension if not exists pgcrypto;

create table if not exists public.gold_system_state (
  id text primary key,
  mode text not null default 'ANALYSIS'
    check (mode in ('ANALYSIS','PAPER','DEMO','LIVE')),
  auto_trading_enabled boolean not null default false,
  emergency_stopped_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.gold_ai_signals (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  timeframe text not null,
  bar_time timestamptz not null,
  strategy_version text not null,
  request_id text not null,
  candidate text not null
    check (candidate in ('BUY','SELL','WAIT')),
  decision text not null
    check (decision in ('BUY','SELL','WAIT')),
  confidence numeric not null,
  market_regime text not null,
  entry numeric,
  stop_loss numeric,
  take_profit numeric,
  risk_reward numeric,
  reason text,
  invalid_reasons jsonb not null default '[]'::jsonb,
  openai_response_id text,
  model text,
  created_at timestamptz not null default now(),
  constraint gold_ai_signals_symbol_timeframe_bar_strategy_key
    unique (symbol,timeframe,bar_time,strategy_version)
);

create table if not exists public.gold_risk_checks (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.gold_ai_signals(id),
  approved boolean not null,
  reasons jsonb not null default '[]'::jsonb,
  age_seconds numeric not null,
  account_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.gold_orders (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references public.gold_ai_signals(id),
  idempotency_key text not null unique,
  symbol text not null,
  mt4_ticket bigint,
  side text check (side in ('BUY','SELL')),
  requested_price numeric,
  filled_price numeric,
  volume numeric,
  stop_loss numeric,
  take_profit numeric,
  status text not null,
  broker_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.gold_trade_results (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.gold_orders(id),
  idempotency_key text not null unique,
  mt4_ticket bigint,
  symbol text not null,
  result text not null
    check (result in ('WIN','LOSS','BREAKEVEN')),
  profit numeric,
  r_multiple numeric,
  holding_seconds bigint,
  exit_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.gold_system_events (
  id uuid primary key default gen_random_uuid(),
  level text not null,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists gold_ai_signals_created_at_idx
  on public.gold_ai_signals(created_at desc);
create index if not exists gold_risk_checks_signal_id_created_at_idx
  on public.gold_risk_checks(signal_id, created_at desc);
create index if not exists gold_orders_created_at_idx
  on public.gold_orders(created_at desc);
create index if not exists gold_trade_results_created_at_idx
  on public.gold_trade_results(created_at desc);
create index if not exists gold_system_events_created_at_idx
  on public.gold_system_events(created_at desc);

alter table public.gold_system_state enable row level security;
alter table public.gold_ai_signals enable row level security;
alter table public.gold_risk_checks enable row level security;
alter table public.gold_orders enable row level security;
alter table public.gold_trade_results enable row level security;
alter table public.gold_system_events enable row level security;

revoke all on table
  public.gold_system_state,
  public.gold_ai_signals,
  public.gold_risk_checks,
  public.gold_orders,
  public.gold_trade_results,
  public.gold_system_events
from anon, authenticated, public;

grant all on table
  public.gold_system_state,
  public.gold_ai_signals,
  public.gold_risk_checks,
  public.gold_orders,
  public.gold_trade_results,
  public.gold_system_events
to service_role;

insert into public.gold_system_state (id, mode, auto_trading_enabled)
values ('global','ANALYSIS',false)
on conflict (id) do nothing;
