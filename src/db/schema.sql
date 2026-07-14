create table if not exists scan_results (
  id            bigserial primary key,
  url           text not null,
  page_type     text not null,       -- 'homepage' | 'category' | 'product'
  device        text not null,       -- 'mobile' | 'desktop'
  run_date      date not null,
  lcp_ms        integer,
  inp_ms        integer,
  cls           numeric,
  perf_score    integer,             -- Lighthouse performance score, 0-100
  http_status   integer,
  scan_failed   boolean not null default false,
  failure_reason      text,
  console_errors      jsonb,         -- [{ text, source }]
  deprecations        jsonb,         -- [{ text, source }]
  render_blocking     jsonb,         -- [url, ...]
  third_party_summary jsonb,         -- [{ domain, blockingTimeMs, transferSize }]
  created_at   timestamptz not null default now()
);

create index if not exists scan_results_url_run_date_idx on scan_results (url, run_date);
create index if not exists scan_results_run_date_idx on scan_results (run_date);

-- Real-user Chrome UX Report (CrUX) field data, added after launch once we noticed lab and
-- field data can disagree significantly (see docs/architecture.md). 'field_data_source' is
-- 'page' (this URL has its own CrUX data), 'origin' (fell back to site-wide data), or 'none'.
alter table scan_results add column if not exists field_data_source text;
alter table scan_results add column if not exists field_lcp_ms integer;
alter table scan_results add column if not exists field_cls numeric;
alter table scan_results add column if not exists field_inp_ms integer;
alter table scan_results add column if not exists field_fcp_ms integer;
alter table scan_results add column if not exists field_ttfb_ms integer;
