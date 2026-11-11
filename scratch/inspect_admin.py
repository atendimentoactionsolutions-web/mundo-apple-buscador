with open('public/admin.html', 'r', encoding='utf-8') as f:
    text = f.read()

import re
sections = re.findall(r'id=["\']([^"\']+)["\']', text)
main_ids = [s for s in sections if any(k in s.lower() for k in ['tab', 'section', 'panel', 'nav', 'page', 'content'])]
print('Main IDs in admin.html:', main_ids[:30])

lines = text.splitlines()
print(f'Total lines in admin.html: {len(lines)}')

for idx, l in enumerate(lines[:100]):
    if '<nav' in l or '<button' in l or '<header' in l:
        print(f'{idx+1}: {l.strip()[:100]}')
