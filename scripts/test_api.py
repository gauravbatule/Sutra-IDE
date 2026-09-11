import requests
import urllib3
import re

urllib3.disable_warnings()

js = requests.get('https://jalwa.vip/assets/js/index-D3t9j8_g.js', verify=False).text
# Find all occurrences of lottery, WinGo, or api.ar-lottery01
print("Looking for lottery endpoints in main bundle...")
for m in set(re.findall(r'https?://[a-zA-Z0-9\.\-_/]+', js)):
    if 'lottery' in m.lower() or 'wingo' in m.lower():
        print(' URL:', m)

# Find chunk names
chunks = set(re.findall(r'assets/js/([a-zA-Z0-9_\-]+\.js)', js))
print(f"Found {len(chunks)} chunks:")
for c in chunks:
    if 'wingo' in c.lower() or 'lottery' in c.lower() or 'game' in c.lower():
        print('  Chunk:', c)

# Let's search all chunks for GetHistoryIssuePage
for c in chunks:
    try:
        chunk_url = f'https://jalwa.vip/assets/js/{c}'
        c_text = requests.get(chunk_url, verify=False, timeout=3).text
        if 'GetHistoryIssuePage' in c_text:
            print(f"*** FOUND in {c} ***")
            for line in re.findall(r'.{0,80}GetHistoryIssuePage.{0,80}', c_text):
                print("   ", line)
    except Exception:
        pass
