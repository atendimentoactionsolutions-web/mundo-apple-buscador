import urllib.request
import json

req = urllib.request.Request('http://127.0.0.1:3333/api/products')
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode())
    prods = data.get('data', [])
    print(f'Total products returned: {len(prods)}')
    for p in prods[:12]:
        name = p.get('name')
        st = p.get('storage')
        col = p.get('color')
        pr = p.get('price')
        print(f"  {name} | {st} | {col} -> Venda: R$ {pr}")
