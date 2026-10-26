#!/usr/bin/env python3
"""Copia o resultado final do 2º turno (presidente e governadores) e as fotos do TSE pra data/tse/,
no mesmo caminho do CDN. O site lê daqui e não depende mais do TSE pra essas páginas."""
import json, os, sys, urllib.request

B = "https://resultados.tse.jus.br/oficial/ele2026"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "tse")
PRES2, EST2 = "6258", "6260"
GOV2 = ["ac", "am", "df", "es", "rn", "to"]


def get(path, parse=True):
    with urllib.request.urlopen(f"{B}/{path}", timeout=30) as r:
        body = r.read()
    dst = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "wb") as f:
        f.write(body)
    return json.loads(body) if parse else None


def u(e, uf, c):
    return f"{e}/dados/{uf}/{uf}-c{c:04d}-e{int(e):06d}-u.json"


def cands(d):
    return [c for cg in d.get("carg", []) for a in cg.get("agr", []) for p in a.get("par", []) for c in p.get("cand", [])]


br = get(u(PRES2, "br", 1))
if br.get("tf") != "s":
    sys.exit("o 2º turno ainda não está totalizado")
ab = get(f"{PRES2}/dados/br/br-e{int(PRES2):06d}-ab.json")
for a in ab["abr"]:
    if a["cdabr"] != "br":
        get(u(PRES2, a["cdabr"], 1))
for c in cands(br):
    get(f"{PRES2}/fotos/br/{c['sqcand']}.jpeg", parse=False)
for uf in GOV2:
    d = get(u(EST2, uf, 3))
    for c in cands(d):
        get(f"{EST2}/fotos/{uf}/{c['sqcand']}.jpeg", parse=False)
print("ok", br["dg"], br["hg"], br["s"]["pstn"] if "pstn" in br["s"] else br["s"])
