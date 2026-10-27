"""Use Git's configured credential helper for GitHub API operations.

Credentials stay in process memory; never written to files or printed.
Default is read-only auth check. --create creates this project's new repo;
--pages enables GitHub Pages after source has been pushed.
"""
import argparse
import json
import os
import subprocess
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--create', action='store_true')
parser.add_argument('--pages', action='store_true')
parser.add_argument('--status', action='store_true')
args = parser.parse_args()
env = dict(os.environ, GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='never')
try:
    result = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True, timeout=20, env=env)
except subprocess.TimeoutExpired:
    raise SystemExit('No non-interactive GitHub credential was available (helper timeout).')
if result.returncode != 0:
    raise SystemExit('No saved GitHub credential is available to the local Git credential helper.')
credential = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
token = credential.get('password')
if not token:
    raise SystemExit('Git credential helper did not return usable GitHub authentication.')

def api(method, path, body=None):
    request = urllib.request.Request('https://api.github.com' + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Santa-vocabulary-deploy'}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read()
            return json.loads(data) if data else {}
    except urllib.error.HTTPError as error:
        try: message = json.loads(error.read()).get('message', 'GitHub rejected the request')
        except Exception: message = 'GitHub rejected the request'
        raise SystemExit(f'GitHub API {method} {path}: HTTP {error.code}: {message}') from None

user = api('GET', '/user')
owner = user['login']
repo = 'santa-vocabulary'
print(json.dumps({'authenticated_as': owner}, ensure_ascii=False))
if owner.lower() != 'jeffhome5370':
    raise SystemExit('Local Git account differs from the connected account; stopped before creating or changing anything.')
if args.create:
    data = api('POST', '/user/repos', {'name': repo, 'description': 'Santa 英文單字室：86 張翻字卡、四選一測驗與複習紀錄', 'private': False, 'auto_init': False})
    print(json.dumps({'repository': data['html_url'], 'default_branch': data['default_branch']}))
if args.pages:
    data = api('POST', f'/repos/{owner}/{repo}/pages', {'build_type': 'workflow'})
    print(json.dumps({'pages_url': data.get('html_url'), 'status': data.get('status')}))
if args.status:
    data = api('GET', f'/repos/{owner}/{repo}/pages')
    runs = api('GET', f'/repos/{owner}/{repo}/actions/runs?per_page=3')
    print(json.dumps({'pages_url': data.get('html_url'), 'status': data.get('status'), 'runs': [{k: run.get(k) for k in ['id', 'status', 'conclusion', 'html_url', 'head_sha']} for run in runs.get('workflow_runs', [])]}))
