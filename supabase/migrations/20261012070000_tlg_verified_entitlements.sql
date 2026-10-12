-- TLG 10:1 share dividends have independent VSDC notices and spot-checked
-- VCI/KBS raw pre-event volume. The VCI rows retain their vendor provenance.
update public.corporate_actions ca
set verification_status = 'VERIFIED',
    metadata = ca.metadata || jsonb_build_object(
      'volume_policy', 'UNADJUSTED_PRE_EVENT',
      'price_policy', 'VENDOR_ALREADY_ADJUSTED',
      'verification_source_url', case ca.ex_date
        when date '2024-11-14' then 'https://vsdc.vn/vi/ad/176348'
        when date '2025-12-11' then 'https://vsdc.vn/vi/ad/189708'
      end,
      'volume_crosscheck', 'VCI_KBS_PRE_AND_POST_EVENT'
    )
from public.symbols s
where ca.symbol_id = s.id and s.symbol = 'TLG'
  and ca.source = 'VCI_VNSTOCK_V5'
  and ca.action_type = 'STOCK_DIVIDEND'
  and ca.ex_date in (date '2024-11-14', date '2025-12-11')
  and ca.ratio = 0.1;

-- Employee placements and private placements confer no subscription or
-- bonus entitlement on an existing holder. Keep the event in the ledger,
-- without treating it as a historical share-volume adjustment event.
update public.corporate_actions ca
set metadata = ca.metadata || '{"entitlement_policy":"NO_EXISTING_HOLDER_ENTITLEMENT"}'::jsonb
where ca.source = 'VCI_VNSTOCK_V5' and ca.action_type = 'OTHER'
  and (lower(ca.metadata->>'event_title') like '%cho cbcnv%'
       or lower(ca.metadata->>'event_title') like '%phát hành riêng lẻ%');
