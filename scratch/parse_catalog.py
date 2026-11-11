import re
import json
import uuid
import sys

def parse_price(val_str):
    # e.g. "Custo R$ 1.499,00" or "Custo R$ 1.049,99"
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
        # maybe cost is in parts[2] or parts[3]
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
    elif re.search(r'\b\d+/\d+\b', specs): # e.g. 128/4, 256/6
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

    return {
        'raw_line': line,
        'name': name,
        'specs': specs,
        'storage': storage or specs,
        'color': color,
        'cost': cost,
        'category': cat,
        'condition': condition,
        'isSeminovo': is_seminovo,
        'region': region,
        'disp_count': disp_count
    }

with open(r'C:\Users\Mundo Apple\.gemini\antigravity\brain\aeba5feb-6e26-4c2e-b114-4725d9badf7e\scratch\raw_paste.txt', 'r', encoding='utf-8') as f:
    text = f.read()

lines = [l.strip() for l in text.splitlines() if l.strip()]
prod_lines = [l for l in lines if not (l.startswith('<') or 'ESSE SAO OS VALORES' in l or 'QUERO QUE' in l or 'ME FALAL' in l or 'The current local time' in l)]

parsed = []
failed = []
for pl in prod_lines:
    item = parse_line(pl)
    if item:
        parsed.append(item)
    else:
        failed.append(pl)

print(f'Total input lines: {len(prod_lines)}')
print(f'Successfully parsed: {len(parsed)}')
print(f'Failed: {len(failed)}')
if failed:
    for f in failed:
        print(' FAILED:', f)

# Group by category & condition
summary = {}
for item in parsed:
    k = (item['category'], item['condition'])
    summary[k] = summary.get(k, 0) + 1

print('\nSummary by (Category, Condition):')
for (cat, cond), count in sorted(summary.items()):
    print(f'  {cat.padEnd(10)} | {cond.padEnd(10)} : {count} itens')
