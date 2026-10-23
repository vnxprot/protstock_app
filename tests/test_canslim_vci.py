from protstock.canslim_vci import normalize_reports

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
