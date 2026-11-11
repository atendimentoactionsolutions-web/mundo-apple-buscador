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

def is_storage_str(s):
    return bool(re.search(r'^(64GB|128GB|256GB|512GB|1TB|2TB|\d+/\d+|40MM|41MM|42MM|44MM|45MM|46MM|49MM)$', s.strip(), re.I))

def is_ram_str(s):
    return bool(re.search(r'^\d+GB$', s.strip(), re.I))

def parse_line_improved(line):
    parts = [p.strip() for p in line.split('•')]
    if len(parts) < 2:
        return None
    
    name = parts[0]
    
    cost = None
    cost_idx = -1
    disp_count = 1

    for idx, p in enumerate(parts):
        if 'Custo R$' in p:
            cost = parse_price(p)
            cost_idx = idx
        elif 'disponibilidade' in p:
            m = re.search(r'(\d+)\s+fornecedor', p)
            if m:
                disp_count = int(m.group(1))

    if cost is None or cost_idx == -1:
        return None

    # Middle attributes are between 1 and cost_idx
    middle = parts[1:cost_idx]
    
    storage = None
    ram = None
    color = 'SEM COR'

    if len(middle) == 1:
        val = middle[0]
        if is_storage_str(val):
            storage = val.upper()
        else:
            color = val.upper()
    elif len(middle) == 2:
        val0, val1 = middle[0], middle[1]
        if is_storage_str(val0):
            storage = val0.upper()
            color = val1.upper()
        elif is_storage_str(val1):
            color = val0.upper()
            storage = val1.upper()
        else:
            storage = val0.upper()
            color = val1.upper()
    elif len(middle) >= 3:
        # E.g. Storage, RAM, Color
        storage = middle[0].upper()
        ram = middle[1].upper()
        color = middle[2].upper()

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

    # Condition detection
    condition = 'NOVO'
    is_seminovo = False
    if 'CPO' in name or 'CPO' in line:
        condition = 'CPO'
    elif 'ATIVADO' in name or 'ATIVADO' in line:
        condition = 'ATIVADO'
    elif 'SEMINOVO' in name or 'SEMINOVO' in line:
        condition = 'SEMINOVO'
        is_seminovo = True

    # Clean display name
    clean_product_name = name
    for tag in [' CPO', ' ATIVADO', ' SEMINOVO']:
        if tag in clean_product_name:
            clean_product_name = clean_product_name.replace(tag, '').strip()

    # Region detection
    region = '(CHIP VIRTUAL) 🇺🇸' if cat == 'IPH' else None

    # Normalize color & storage strings
    if color in ['SEM COR', 'SEM-COR', 'SEMCOR']:
        clean_color = 'Sem cor'
    else:
        clean_color = color.title()

    clean_storage = storage or 'Padrão'
    if ram:
        clean_storage = f"{clean_storage} / {ram} RAM"

    desc = f"{cat} - {clean_storage} - {clean_color}"

    return {
        'id': str(uuid.uuid4()),
        'name': clean_product_name,
        'originalName': name,
        'description': desc,
        'price': cost,
        'isActive': True,
        'category': cat,
        'storage': clean_storage,
        'color': clean_color,
        'ram': ram,
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

lines = [l.strip() for l in text.splitlines() if l.strip() and not l.startswith('<') and not 'ESSE SAO' in l and not 'QUERO QUE' in l and not 'ME FALAL' in l and not 'The current' in l]

items = [parse_line_improved(l) for l in lines]
items = [i for i in items if i]

apple_novos = [i for i in items if i['condition'] == 'NOVO' and i['category'] != 'ANDROID']
cpo_items = [i for i in items if i['condition'] == 'CPO']
ativados_items = [i for i in items if i['condition'] == 'ATIVADO']
android_items = [i for i in items if i['category'] == 'ANDROID']

print(f'Total parsed items: {len(items)}')
print(f'Apple Novos: {len(apple_novos)}')
print(f'Apple CPO: {len(cpo_items)}')
print(f'Apple Ativados: {len(ativados_items)}')
print(f'Hotwav Android: {len(android_items)}')

with open('data/novos_apple_importados.json', 'w', encoding='utf-8') as f:
    json.dump(apple_novos, f, indent=2, ensure_ascii=False)

with open('data/cpo_importados.json', 'w', encoding='utf-8') as f:
    json.dump(cpo_items, f, indent=2, ensure_ascii=False)

with open('data/ativados_importados.json', 'w', encoding='utf-8') as f:
    json.dump(ativados_items, f, indent=2, ensure_ascii=False)

with open('data/android_hotwav_importados.json', 'w', encoding='utf-8') as f:
    json.dump(android_items, f, indent=2, ensure_ascii=False)

print('Updated separated JSON files in data/')
