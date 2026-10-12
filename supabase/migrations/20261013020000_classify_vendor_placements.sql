-- The first full VCI import ran while the v0 classification was rolling out.
-- These issuance categories create no proportional entitlement for an
-- existing holder and must not be mistaken for a split or rights issue.
update public.corporate_actions ca
set metadata = ca.metadata || '{"entitlement_policy":"NO_EXISTING_HOLDER_ENTITLEMENT"}'::jsonb
where ca.source = 'VCI_VNSTOCK_V5' and ca.action_type = 'OTHER'
  and (lower(ca.metadata->>'event_title') like '%cho cbcnv%'
       or lower(ca.metadata->>'event_title') like '%phát hành riêng lẻ%'
       or lower(ca.metadata->>'event_title') like '%trái phiếu chuyển đổi%'
       or lower(ca.metadata->>'event_title') like '%qua đấu giá%'
       or lower(ca.metadata->>'event_title') like '%để sáp nhập%'
       or lower(ca.metadata->>'event_title') like '%cho trái chủ%');
