"""Gera static.js: paths SVG das UFs (malha IBGE) + resultado final do 1º turno por UF.
Uso: python3 scripts/build-static.py <br.geojson> > static.js"""
import json, math, sys, urllib.request

IBGE = {11:'ro',12:'ac',13:'am',14:'rr',15:'pa',16:'ap',17:'to',21:'ma',22:'pi',23:'ce',24:'rn',25:'pb',26:'pe',27:'al',28:'se',29:'ba',31:'mg',32:'es',33:'rj',35:'sp',41:'pr',42:'sc',43:'rs',50:'ms',51:'mt',52:'go',53:'df'}
B = "https://resultados.tse.jus.br/oficial/ele2026"

geo = json.load(open(sys.argv[1]))
K = math.cos(math.radians(15))  # correção de aspecto aproximada pro Brasil
lon0, lat0, S = -74.2, 5.5, 25.0
def pt(x, y): return round((x - lon0) * K * S), round((lat0 - y) * S)

paths = {}
for f in geo["features"]:
    uf = IBGE[int(f["properties"]["codarea"])]
    g = f["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    d = []
    for poly in polys:
        for ring in poly:
            pts, last = [], None
            for x, y in ring:
                p = pt(x, y)
                if p != last: pts.append(p); last = p
            if len(pts) > 2:
                d.append("M" + "L".join(f"{a:g},{b:g}" for a, b in pts) + "Z")
    paths[uf] = "".join(d)

def get(u): return json.load(urllib.request.urlopen(u, timeout=30))
def summary(d):
    cs = {}
    for cg in d["carg"]:
        for a in cg["agr"]:
            for p in a["par"]:
                for c in p["cand"]:
                    cs[c["n"]] = [int(c["vap"]), float(c["pvapn"].replace(",", "."))]
    return {"c": cs, "vv": int(d["v"]["vv"]), "comp": float(d["e"]["pcn"].replace(",", ".")), "te": int(d["e"]["te"])}

t1 = {}
for uf in list(IBGE.values()) + ["zz", "br"]:
    t1[uf] = summary(get(f"{B}/6257/dados/{uf}/{uf}-c0001-e006257-u.json"))

print("window.STATIC=" + json.dumps({"vb": "0 0 %d %d" % (round(40.5 * K * S), round(39.5 * S)), "paths": paths, "t1": t1}, separators=(",", ":")) + ";")
