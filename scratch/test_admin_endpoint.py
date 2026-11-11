import urllib.request
import json

token = "c320070f-1d64-4ae1-aaab-a3efff85f0cf"

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
    headers={
        'Content-Type': 'application/json',
        'Cookie': f'fornecedor_session={token}',
        'Authorization': f'Bearer {token}'
    },
    method='POST'
)

with urllib.request.urlopen(import_req) as resp:
    print('Import status:', resp.status)
    result = json.loads(resp.read().decode())
    print('Import result:')
    print(json.dumps(result, indent=2, ensure_ascii=False))
