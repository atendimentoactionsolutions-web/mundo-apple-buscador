with open('public/admin.html', 'r', encoding='utf-8') as f:
    text = f.read()

lines = text.splitlines()
for idx, l in enumerate(lines):
    if any(k in l for k in ['/api/auth/me', '/api/users', '/api/margins', 'checkAuth', 'authToken']):
        print(f'{idx+1}: {l.strip()[:100]}')
