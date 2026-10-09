"""Add ISRG Root X1 (certificate + NSS trust object) to a COPY of a KaiOS cert9.db.

usage: python add_isrg_root.py <cert9.db in> <isrgrootx1.der> <cert9.db out>

Field formulas are validated against every certificate already stored in the database
before anything is inserted (issuer, serial, subject, CKA_ID); aborts on any mismatch.
"""
import sqlite3, shutil, hashlib, sys

SRC, DER, DST = sys.argv[1], sys.argv[2], sys.argv[3]


def tlv(b, p):
    tag = b[p]
    l = b[p + 1]
    p += 2
    if l & 0x80:
        n = l & 0x7f
        l = int.from_bytes(b[p:p + n], 'big')
        p += n
    return tag, p, p + l


def parse_cert(der):
    _, s, e = tlv(der, 0)
    _, s, e_tbs = tlv(der, s)
    p = s
    t, cs, ce = tlv(der, p)
    if t == 0xa0:
        p = ce
        t, cs, ce = tlv(der, p)
    serial_full = der[p:ce]
    p = ce
    t, cs, ce = tlv(der, p)             # signature alg
    p = ce
    t, cs, ce = tlv(der, p)             # issuer
    issuer = der[p:ce]
    p = ce
    t, cs, ce = tlv(der, p)             # validity
    p = ce
    t, cs, ce = tlv(der, p)             # subject
    subject = der[p:ce]
    p = ce
    t, cs, ce = tlv(der, p)             # SPKI
    q = cs
    t2, a, b2 = tlv(der, q)             # alg id
    q = b2
    t3, a3, b3 = tlv(der, q)            # BIT STRING
    keybits = der[a3 + 1:b3]
    if keybits[0] == 0x30:              # RSAPublicKey -> SHA1(modulus without leading zero)
        t, ks, ke = tlv(keybits, 0)
        t, na, nb = tlv(keybits, ks)
        cid = hashlib.sha1(keybits[na:nb].lstrip(b'\x00')).digest()
    else:                               # EC point -> SHA1(point)
        cid = hashlib.sha1(keybits).digest()
    return dict(serial=serial_full, issuer=issuer, subject=subject, id=cid)


c = sqlite3.connect(SRC)
rows = c.execute("select a3,a11,a81,a82,a101,a102 from nssPublic where a0=x'00000001'").fetchall()
ok = bad = 0
for label, der, a81, a82, a101, a102 in rows:
    f = parse_cert(der)
    if f['issuer'] == a81 and f['serial'] == a82 and f['subject'] == a101 and f['id'] == a102:
        ok += 1
    else:
        bad += 1
        print('MISMATCH on', label)
print('validated existing certificates: ok=%d mismatch=%d' % (ok, bad))
if bad or (rows and not ok):
    print('VALIDATION FAILED - not inserting')
    sys.exit(1)
if not rows:
    print('NOTE: no existing certificate rows to validate against; formulas validated on the 8110 database')

root = open(DER, 'rb').read()
if hashlib.sha256(root).hexdigest() != '96bcec06264976f37460779acf28c5a7cfe8a3c0aae11a8ffcee05c0bddf08c6':
    print('root certificate fingerprint mismatch - aborting')
    sys.exit(1)
r = parse_cert(root)
sha1 = hashlib.sha1(root).digest()
md5 = hashlib.md5(root).digest()
have_cert = c.execute("select count(*) from nssPublic where a0=x'00000001' and a11=?", (root,)).fetchone()[0]
have_trust = c.execute("select count(*) from nssPublic where a0=x'ce534353' and a81=? and a82=?", (r['issuer'], r['serial'])).fetchone()[0]
print('already in db: certificate=%d trust=%d' % (have_cert, have_trust))
if have_cert and have_trust:
    print('ISRG Root X1 already trusted - nothing to do')
    sys.exit(2)
c.close()

shutil.copy(SRC, DST)
d = sqlite3.connect(DST)
maxid = d.execute('select max(id) from nssPublic').fetchone()[0] or 0
label = b'ISRG Root X1'
nxt = maxid + 1
if not have_cert:
    d.execute('insert into nssPublic (id,a0,a1,a2,a3,a11,a80,a81,a82,a101,a102,a170) values (?,?,?,?,?,?,?,?,?,?,?,?)',
              (nxt, (1).to_bytes(4, 'big'), b'\x01', b'\x00', label, root, (0).to_bytes(4, 'big'),
               r['issuer'], r['serial'], r['subject'], r['id'], b'\x01'))
    nxt += 1
if not have_trust:
    d.execute('insert into nssPublic (id,a0,a1,a2,a3,a81,a82,a170,ace5363b4,ace5363b5,ace536358,ace536359,ace53635a,ace53635b,ace536360) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
              (nxt, bytes.fromhex('ce534353'), b'\x01', b'\x00', label, r['issuer'], r['serial'], b'\x01',
               sha1, md5, bytes.fromhex('ce534352'), bytes.fromhex('ce534354'), bytes.fromhex('ce534354'),
               bytes.fromhex('ce534354'), b'\x00'))
d.commit()
print('integrity:', d.execute('pragma integrity_check').fetchone()[0], '| rows:', d.execute('select count(*) from nssPublic').fetchone()[0])
d.close()
print('wrote', DST)
