-- Enable the complete private Core Engine/Pack catalog as the initial default.
-- This is deliberately a new forward-only migration; later toggle changes remain user-controlled.
update public.rules
set status = 'ACTIVE', updated_at = now()
where user_id = (select id from auth.users where email = 'prot@protstock.local' limit 1)
  and kind = 'CORE_PACK';
