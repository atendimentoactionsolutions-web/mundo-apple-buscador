with open('public/admin.html', 'r', encoding='utf-8') as f:
    text = f.read()

import re
h_tags = re.findall(r'<h[1-4][^>]*>([^<]+)</h[1-4]>', text)
print('Headings in admin.html:')
for h in h_tags:
    print(' -', h.strip())

btn_tags = re.findall(r'<button[^>]*>([^<]+)</button>', text)
print('\nButtons in admin.html:')
for b in btn_tags[:25]:
    if b.strip():
        print(' -', b.strip())
