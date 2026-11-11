import json

with open(r'C:\Users\Mundo Apple\.gemini\antigravity\brain\aeba5feb-6e26-4c2e-b114-4725d9badf7e\.system_generated\logs\transcript_full.jsonl', 'r', encoding='utf-8') as f:
    for line in f:
        d = json.loads(line)
        if d.get('source') == 'USER_EXPLICIT':
            text = d.get('content', '')
            if any(k in text.lower() for k in ['vps', 'hostinger', 'dominio', 'link', 'site', 'ip']):
                print(f"STEP {d.get('step_index')}: {text.strip()[:200]}")
