import requests, urllib3, re
urllib3.disable_warnings()
js = requests.get('https://jalwa.vip/assets/js/main.vue_vue_type_style_index_0_scoped_d3b4a951_lang-DP0Jhw5w.js', verify=False).text
for m in re.finditer(r'issueNumber|nextIssue|currentIssue|issueList', js, re.IGNORECASE):
    idx = m.start()
    print('Found issue at', idx)
    print(js[max(0, idx-100):idx+150].encode('ascii', errors='replace').decode())
    print('-'*50)
