-- Apply the 25/09/2026 approved universe update. EOD, breadth and signal
-- processing read public.symbols where active = true, ordered by symbol.
insert into public.symbols (symbol, company_name, sector, exchange, active, metadata)
values
  ('APH', 'CTCP Tập đoàn An Phát Holdings', 'BE TONG_NHUA DUONG', 'HOSE', true, jsonb_build_object('source_file', '20260925_prot-stock-danh-sach-co-phieu.xlsx', 'source_sha256', '4e213edf4af615251e2191f6603a946314d009770d877f4a9fcf87392c348bbf', 'universe_updated_on', '2026-09-25')),
  ('HII', 'CTCP An Tiến Industries', 'BE TONG_NHUA DUONG', 'HOSE', true, jsonb_build_object('source_file', '20260925_prot-stock-danh-sach-co-phieu.xlsx', 'source_sha256', '4e213edf4af615251e2191f6603a946314d009770d877f4a9fcf87392c348bbf', 'universe_updated_on', '2026-09-25')),
  ('MZG', 'CTCP MiZa', 'GIAY_BAO BI', 'HOSE', true, jsonb_build_object('source_file', '20260925_prot-stock-danh-sach-co-phieu.xlsx', 'source_sha256', '4e213edf4af615251e2191f6603a946314d009770d877f4a9fcf87392c348bbf', 'universe_updated_on', '2026-09-25')),
  ('TDP', 'CTCP Thuận Đức', 'BE TONG_NHUA DUONG', 'HOSE', true, jsonb_build_object('source_file', '20260925_prot-stock-danh-sach-co-phieu.xlsx', 'source_sha256', '4e213edf4af615251e2191f6603a946314d009770d877f4a9fcf87392c348bbf', 'universe_updated_on', '2026-09-25')),
  ('VNB', 'CTCP Sách Việt Nam', 'GIAY_BAO BI', 'UPCOM', true, jsonb_build_object('source_file', '20260925_prot-stock-danh-sach-co-phieu.xlsx', 'source_sha256', '4e213edf4af615251e2191f6603a946314d009770d877f4a9fcf87392c348bbf', 'universe_updated_on', '2026-09-25')),
  ('VTZ', 'CTCP Sản xuất và Thương mại Nhựa Việt Thành', 'BE TONG_NHUA DUONG', 'HNX', true, jsonb_build_object('source_file', '20260925_prot-stock-danh-sach-co-phieu.xlsx', 'source_sha256', '4e213edf4af615251e2191f6603a946314d009770d877f4a9fcf87392c348bbf', 'universe_updated_on', '2026-09-25'))
on conflict (symbol) do update
set company_name = excluded.company_name,
    sector = excluded.sector,
    exchange = excluded.exchange,
    active = excluded.active,
    metadata = public.symbols.metadata || excluded.metadata;