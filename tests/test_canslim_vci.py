from protstock.canslim_vci import metric_name, normalize_reports, normalize_overview

def test_vci_mapping_and_same_scope_roe():
    meta={'INCOME_STATEMENT':[{'field':'a','titleEn':'Basic EPS'},{'field':'b','titleEn':'Net revenue'},{'field':'c','titleEn':'Profit after tax'}], 'BALANCE_SHEET':[{'field':'d','titleEn':'Total equity'}]}
    reports={'INCOME_STATEMENT':{'years':[{'yearReport':2025,'a':200,'b':1000,'c':180}]}, 'BALANCE_SHEET':{'years':[{'yearReport':2025,'d':1200},{'yearReport':2024,'d':800}]}}
    rows=normalize_reports(meta,reports)
    assert rows[0]['eps']==200
    assert rows[0]['roe']==18
    assert 'roa' not in rows[0]

def test_missing_data_is_not_zero_and_no_quarter_roe_annualization():
    meta={'INCOME_STATEMENT':[{'field':'a','titleEn':'Basic EPS'}]}
    rows=normalize_reports(meta,{'INCOME_STATEMENT':{'quarters':[{'yearReport':2026,'lengthReport':2,'a':None}]}})
    assert 'eps' not in rows[0]
    assert 'roe' not in rows[0]


def test_actual_vci_eps_labels():
    assert metric_name({'titleEn': 'EPS basic (VND)'}) == 'eps'
    assert metric_name({'titleEn': 'EPS diluted (VND)'}) == 'eps_diluted'


def test_vendor_snapshot_units_periods_and_no_inferred_float():
    financial = [
        {'period': '2026-Q3', 'kind': 'quarter', 'year': 2026, 'quarter': 3, 'eps': 1200, 'roe': 99, 'labels': {}},
        {'period': '2025', 'kind': 'year', 'year': 2025, 'quarter': 0, 'labels': {}},
    ]
    ratios = [
        {'yearReport': 2026, 'quarter': 3, 'ratioType': 'RATIO_TTM', 'pe': 4.8, 'roe': .2872, 'roa': .1436},
        {'yearReport': 2025, 'quarter': 4, 'ratioType': 'RATIO_TTM', 'pe': 5.5, 'roe': .17},
    ]
    overview = normalize_overview({'marketCap': 7e12, 'freeFloatPercentage': .3}, ratios, financial)
    assert overview['free_float_pct'] == 30
    assert overview['market_cap'] == 7e12
    assert overview['pe'] == 4.8
    assert overview['ratio_period'] == '2026-Q3'
    assert overview['eps'] == 1200 and overview['eps_period'] == '2026-Q3'
    assert overview['eps_basis'] == 'EPS cơ bản · quý'
    assert abs(financial[0]['roe'] - 28.72) < 1e-8
    assert financial[1]['roe'] == 17
    assert 'VCI' in financial[0]['labels']['roe']
    missing = normalize_overview({'statePercentage': .6}, [], financial)
    assert missing['free_float_pct'] is None
    assert missing['pe'] is None and missing['roe'] is None
    assert 'roe' not in financial[0]
