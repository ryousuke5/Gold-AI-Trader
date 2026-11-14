-- Research-only GOLD Forward/Paper shadow telemetry.
-- This table stores observations only; it does not create orders or alter risk state.
create table if not exists public.gold_forward_shadow_events (
  event_key text primary key,
  entry_id text not null,
  event_type text not null check (event_type in ('ENTRY', 'BAR', 'GAP', 'EXIT')),
  symbol text not null,
  strategy_version text not null,
  side text not null check (side in ('BUY', 'SELL')),
  event_time timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists gold_forward_shadow_events_entry_time_idx
  on public.gold_forward_shadow_events (entry_id, event_time);

create index if not exists gold_forward_shadow_events_symbol_time_idx
  on public.gold_forward_shadow_events (symbol, event_time desc);

create index if not exists gold_forward_shadow_events_strategy_type_time_idx
  on public.gold_forward_shadow_events (strategy_version, event_type, event_time desc);

alter table public.gold_forward_shadow_events enable row level security;

revoke all on table public.gold_forward_shadow_events from anon, authenticated;
grant all on table public.gold_forward_shadow_events to service_role;
