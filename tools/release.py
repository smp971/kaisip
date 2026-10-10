"""Build every release artefact into dist/release/ and write SHA256SUMS.txt.

  kaisip-<v>-gerdapkg.zip              certified, GerdaPkg / OmniSD layout (application.zip + metadata.json)
  kaisip-<v>-privileged-gerdapkg.zip   privileged variant (no earpiece switching), same layout
  kaisip-<v>-application.zip           the packaged app itself (WebIDE, tools/rdp_install.py, mozApps.mgmt.import)
  kaisip-diag-<v>-gerdapkg.zip         audio routing / volume diagnostics (certified)
  kaisip-<v>-source.zip                `git archive` of the current commit
  SHA256SUMS.txt

usage: python tools/release.py
"""
import os, sys, hashlib, subprocess, shutil, json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build

ROOT = build.ROOT
OUT = os.path.join(ROOT, 'dist', 'release')

manifest = json.load(open(os.path.join(ROOT, 'app', 'manifest.webapp'), encoding='utf-8-sig'))
v = manifest['version']
if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

artefacts = []
info = build.pack(os.path.join(ROOT, 'app'), os.path.join(OUT, 'kaisip-%s-gerdapkg.zip' % v),
                  raw_out=os.path.join(OUT, 'kaisip-%s-application.zip' % v))
artefacts += [info['out'], info['raw']]
info = build.pack(os.path.join(ROOT, 'app'), os.path.join(OUT, 'kaisip-%s-privileged-gerdapkg.zip' % v), variant='privileged')
artefacts.append(info['out'])
dman = json.load(open(os.path.join(ROOT, 'tools', 'diag', 'app', 'manifest.webapp'), encoding='utf-8-sig'))
info = build.pack(os.path.join(ROOT, 'tools', 'diag', 'app'), os.path.join(OUT, 'kaisip-diag-%s-gerdapkg.zip' % dman['version']),
                  extra=[('app/js/log.js', 'js/log.js')])
artefacts.append(info['out'])

src = os.path.join(OUT, 'kaisip-%s-source.zip' % v)
subprocess.run(['git', 'archive', '--format=zip', '--prefix=kaisip-%s/' % v, '-o', src, 'HEAD'], cwd=ROOT, check=True)
artefacts.append(src)
dirty = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
if dirty:
    print('WARNING: working tree has uncommitted changes; the source zip is the last commit only')

lines = []
for path in sorted(artefacts):
    h = hashlib.sha256(open(path, 'rb').read()).hexdigest()
    lines.append('%s  %s' % (h, os.path.basename(path)))
    print('%-48s %8d bytes' % (os.path.basename(path), os.path.getsize(path)))
open(os.path.join(OUT, 'SHA256SUMS.txt'), 'w', newline='\n').write('\n'.join(lines) + '\n')
print('wrote', os.path.join(OUT, 'SHA256SUMS.txt'))
