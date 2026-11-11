import urllib.request
import json

req = urllib.request.Request('http://127.0.0.1:3333/api/products')
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode())
    prods = data.get('data', [])
    print(f'Total products returned: {len(prods)}')
    
    # filter some categories
    iphones = [p for p in prods if p.get('category') == 'IPH'][:4]
    macs = [p for p in prods if p.get('category') == 'MCB'][:4]
    ipads = [p for p in prods if p.get('category') == 'IPAD'][:4]
    watches = [p for p in prods if p.get('category') == 'RLG'][:4]

    print('\niPhones:')
    for p in iphones:
        print(f"  {p.get('name')} | {p.get('storage')} | {p.get('color')} -> Venda: R$ {p.get('price')}")
    print('\nMacs:')
    for p in macs:
        print(f"  {p.get('name')} | {p.get('storage')} | {p.get('color')} -> Venda: R$ {p.get('price')}")
    print('\niPads:')
    for p in ipads:
        print(f"  {p.get('name')} | {p.get('storage')} | {p.get('color')} -> Venda: R$ {p.get('price')}")
    print('\nWatches:')
    for p in watches:
        print(f"  {p.get('name')} | {p.get('storage')} | {p.get('color')} -> Venda: R$ {p.get('price')}")
