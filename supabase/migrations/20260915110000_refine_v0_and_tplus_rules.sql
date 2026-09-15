-- Correct the product grouping: Cup with Handle and Rounding Bottom are one
-- mutually exclusive structural family, so Core v0.1 has six groups, not seven.
update public.rules
set input_text = '6 nhóm: nền phẳng, cờ/pennant, hai đáy, hai đỉnh, vai đầu vai, cốc tay cầm/đáy tròn',
    updated_at = now()
where user_id = (select id from auth.users where email = 'prot@protstock.local' limit 1)
  and name = 'Prot Core Engine v0.0' and kind = 'CORE_PACK';

update public.rules
set input_text = 'T+ Pullback: Tuần tăng hoặc đi ngang khỏe (đóng ≥ EMA20 Tuần); hồi 3–7 phiên về EMA10/EMA20/SMA50; volume hồi ≤90% 7 phiên trước; RSI14 45–72; nến xanh đóng cao hơn phiên trước với volume ≥1,1× TB20. Policy chung kiểm tra VN-Index, thanh khoản, stop, danh mục. Entry 1–3 phiên, time-stop 5–8 phiên, chốt một phần tại 1R/kháng cự.',
    pack_version = 'v1.1', updated_at = now()
where user_id = (select id from auth.users where email = 'prot@protstock.local' limit 1)
  and name = 'Prot Core Pack · T+ Pullback' and kind = 'CORE_PACK';
