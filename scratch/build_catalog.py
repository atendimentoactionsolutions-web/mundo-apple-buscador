import re
import json
import uuid
from datetime import datetime

def parse_price(val_str):
    m = re.search(r'Custo\s+R\$\s*([\d\.,]+)', val_str)
    if not m:
        return None
    raw = m.group(1).replace('.', '').replace(',', '.')
    try:
        return float(raw)
    except:
        return None

def parse_line(line):
    parts = [p.strip() for p in line.split('•')]
    if len(parts) < 3:
        return None
    
    name = parts[0]
    specs = parts[1]
    color = parts[2]
    cost_part = None
    supplier_info = None

    for p in parts[3:]:
        if 'Custo R$' in p:
            cost_part = p
        elif 'disponibilidade' in p:
            supplier_info = p
    
    if not cost_part:
        for p in parts:
            if 'Custo R$' in p:
                cost_part = p
                break
    
    if not cost_part:
        return None

    cost = parse_price(cost_part)
    if cost is None:
        return None

    # Condition detection
    condition = 'NOVO'
    is_seminovo = False
    if 'CPO' in name or 'CPO' in specs or 'CPO' in line:
        condition = 'CPO'
    elif 'ATIVADO' in name or 'ATIVADO' in specs or 'ATIVADO' in line:
        condition = 'ATIVADO'
    elif 'SEMINOVO' in name or 'SEMINOVO' in line:
        condition = 'SEMINOVO'
        is_seminovo = True

    # Storage detection
    storage = None
    if re.search(r'\b(64GB|128GB|256GB|512GB|1TB|2TB)\b', specs, re.I):
        m = re.search(r'\b(64GB|128GB|256GB|512GB|1TB|2TB)\b', specs, re.I)
        storage = m.group(1).upper()
    elif re.search(r'\b\d+/\d+\b', specs):
        storage = specs
    elif re.search(r'\b(40MM|41MM|42MM|44MM|45MM|46MM|49MM)\b', specs, re.I):
        storage = specs.upper()
    elif 'Sem cor' in color and not storage:
        storage = specs

    # Category detection
    cat = 'ACSS'
    clean_n = name.upper()
    if 'HOTWAV' in clean_n:
        cat = 'ANDROID'
    elif 'APPLE TV' in clean_n:
        cat = 'APPLE_TV'
    elif 'AIRPODS' in clean_n:
        cat = 'PODS'
    elif 'IPAD' in clean_n:
        cat = 'IPAD'
    elif 'IPHONE' in clean_n:
        cat = 'IPH'
    elif any(k in clean_n for k in ['MACBOOK', 'IMAC', 'MAC MINI', 'MAC STUDIO']):
        cat = 'MCB'
    elif 'APPLE WATCH' in clean_n:
        cat = 'RLG'
    elif any(k in clean_n for k in ['PENCIL', 'MAGIC KEYBOARD', 'MAGIC MOUSE', 'MAGIC TRACKPAD', 'SMART KEYBOARD', 'SMART FOLIO', 'AIRTAG']):
        cat = 'ACSS'

    # Region detection
    region = '(CHIP VIRTUAL) 🇺🇸' if cat == 'IPH' else None

    # Supplier
    disp_count = 1
    if supplier_info:
        m = re.search(r'(\d+)\s+fornecedor', supplier_info)
        if m:
            disp_count = int(m.group(1))

    # Clean name for Apple catalog
    clean_product_name = name
    if ' CPO' in clean_product_name:
        clean_product_name = clean_product_name.replace(' CPO', '').strip()
    if ' ATIVADO' in clean_product_name:
        clean_product_name = clean_product_name.replace(' ATIVADO', '').strip()

    return {
        'id': str(uuid.uuid4()),
        'name': clean_product_name,
        'originalName': name,
        'description': f"{cat} - {storage or specs} - {color}",
        'price': cost,
        'isActive': True,
        'category': cat,
        'storage': storage or specs,
        'color': color.upper(),
        'region': region,
        'imageUrl': None,
        'priceDate': '11-11',
        'sheetDate': '11-11',
        'listTimestamp': datetime.now().strftime('%H:%M:%S'),
        'sheetTimestamp': datetime.now().strftime('%H:%M:%S'),
        'supplier': {
            'id': 'fornecedor-oficial',
            'name': 'FORNECEDOR OFICIAL',
            'whatsappNumber': '+55 11 98254-2277',
            'address': 'SHOPPING ORIENTAL',
            'locationFilter': 'SHOPPING ORIENTAL',
            'priority': 0,
            'isVerified': True
        },
        'isSeminovo': is_seminovo,
        'condition': condition,
        'dispCount': disp_count
    }

with open(r'C:\Users\Mundo Apple\.gemini\antigravity\brain\aeba5feb-6e26-4c2e-b114-4725d9badf7e\scratch\raw_paste.txt', 'r', encoding='utf-8') as f:
    text = f.read()

lines = [l.strip() for l in text.splitlines() if l.strip()]
prod_lines = [l for l in lines if not (l.startswith('<') or 'ESSE SAO OS VALORES' in l or 'QUERO QUE' in l or 'ME FALAL' in l or 'The current local time' in l)]

all_items = []
for pl in prod_lines:
    item = parse_line(pl)
    if item:
        all_items.append(item)

# Separate categories:
apple_novos = [i for i in all_items if i['condition'] == 'NOVO' and i['category'] != 'ANDROID']
cpo_items = [i for i in all_items if i['condition'] == 'CPO']
ativados_items = [i for i in all_items if i['condition'] == 'ATIVADO']
android_items = [i for i in all_items if i['category'] == 'ANDROID']

print(f'Total parsed items: {len(all_items)}')
print(f'Apple Novos: {len(apple_novos)}')
print(f'Apple CPO: {len(cpo_items)}')
print(f'Apple Ativados: {len(ativados_items)}')
print(f'Hotwav Android: {len(android_items)}')

# Save separated JSONs in data/
with open('data/novos_apple_importados.json', 'w', encoding='utf-8') as f:
    json.dump(apple_novos, f, indent=2, ensure_ascii=False)

with open('data/cpo_importados.json', 'w', encoding='utf-8') as f:
    json.dump(cpo_items, f, indent=2, ensure_ascii=False)

with open('data/ativados_importados.json', 'w', encoding='utf-8') as f:
    json.dump(ativados_items, f, indent=2, ensure_ascii=False)

with open('data/android_hotwav_importados.json', 'w', encoding='utf-8') as f:
    json.dump(android_items, f, indent=2, ensure_ascii=False)

print('Separated files saved in data/')
