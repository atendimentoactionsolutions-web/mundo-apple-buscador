import urllib.request
import json
import http.cookiejar

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

# 1. Login as admin
login_payload = json.dumps({'username': 'cledson', 'password': '123'}).encode('utf-8')
login_req = urllib.request.Request('http://127.0.0.1:3333/api/auth/login', data=login_payload, headers={'Content-Type': 'application/json'})

try:
    with opener.open(login_req) as resp:
        print('Login status:', resp.status)
        user_data = json.loads(resp.read().decode())
        print('Logged in user:', user_data.get('user', {}).get('username'))
except Exception as e:
    print('Login failed:', e)
    # try test login or inspect users.json
    exit(1)

# 2. Test POST /api/admin/daily-prices
test_list = """
APPLE TV 4K • 128GB • Sem cor • Custo R$ 1.499,00 • Baixa disponibilidade: 1 fornecedor
HOTWAV A17 PRO MAX • 128/4 • SILVER • Custo R$ 650,00
IPHONE 13 VITRINE • 128GB • MIDNIGHT • Custo R$ 2.400,00
IPHONE 16 PRO MAX • 256GB • BLACK • Custo R$ 6.100,00
"""

import_payload = json.dumps({
    'rawText': test_list,
    'date': '11-11',
    'mode': 'append'
}).encode('utf-8')

import_req = urllib.request.Request(
    'http://127.0.0.1:3333/api/admin/daily-prices',
    data=import_payload,
    headers={'Content-Type': 'application/json'},
    method='POST'
)

with opener.open(import_req) as resp:
    print('Import status:', resp.status)
    result = json.loads(resp.read().decode())
    print('Import result:')
    print(json.dumps(result, indent=2, ensure_ascii=False))
