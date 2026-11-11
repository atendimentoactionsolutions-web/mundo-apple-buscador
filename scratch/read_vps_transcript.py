import json

with open(r'C:\Users\Mundo Apple\.gemini\antigravity\brain\aeba5feb-6e26-4c2e-b114-4725d9badf7e\.system_generated\logs\transcript.jsonl', 'r', encoding='utf-8') as f:
    for line in f:
        d = json.loads(line)
        idx = d.get('step_index')
        if idx in [1694, 1695, 1696, 1697, 1698]:
            print(f'=== STEP {idx} ({d.get("type")}) ===')
            content = d.get('content', '')
            print(content[:800] if content else '(empty content)')
