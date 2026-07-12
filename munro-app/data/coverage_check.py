import json, time, urllib.request, urllib.parse, math, sys

ENDPOINTS=["https://overpass.kumi.systems/api/interpreter",
           "https://overpass-api.de/api/interpreter",
           "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
samples=[
 ("Ben Nevis",56.7969,-5.0037,"honeypot"),
 ("Ben Lomond",56.1903,-4.6330,"honeypot"),
 ("Cairn Gorm",57.1167,-3.6445,"ski infra"),
 ("Schiehallion",56.6669,-4.1002,"single path"),
 ("Ben Alder",56.8139,-4.4653,"long walk-in"),
 ("Seana Bhraigh",57.8501,-4.9161,"remote"),
 ("Sgurr na Ciche",57.0085,-5.4666,"knoydart pathless"),
 ("Bidein a Choire Sheasgaich",57.4437,-5.2291,"hard to reach"),
]
def bbox(lat,lon,km=2.5):
    dlat=km/111.0; dlon=km/(111.0*math.cos(math.radians(lat)))
    return (lat-dlat,lon-dlon,lat+dlat,lon+dlon)
def query(q):
    data=urllib.parse.urlencode({"data":q}).encode()
    last=None
    for ep in ENDPOINTS:
        try:
            req=urllib.request.Request(ep,data=data,headers={"User-Agent":"munro-app/0.1","Accept":"application/json"})
            with urllib.request.urlopen(req,timeout=60) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            last=f"{ep.split('/')[2]}: {e}"; time.sleep(2)
    raise RuntimeError(last)

out=open("munro-app/data/coverage_results.tsv","w")
out.write("munro\tways\tlen_km\tw_vis\tw_sac\tinformal\tnote\n"); out.flush()
for name,lat,lon,note in samples:
    s,w,n,e=bbox(lat,lon)
    q=f'[out:json][timeout:60];(way["highway"~"^(path|footway|track|bridleway|steps)$"]({s},{w},{n},{e}););out geom;'
    try:
        d=query(q); ways=d.get("elements",[])
    except Exception as ex:
        out.write(f"{name}\tERR\t\t\t\t\t{ex}\n"); out.flush(); continue
    tot=0.0; vis=sac=inf=0
    for wy in ways:
        tg=wy.get("tags",{})
        vis+= "trail_visibility" in tg
        sac+= "sac_scale" in tg
        inf+= tg.get("informal")=="yes"
        g=wy.get("geometry",[])
        for a,b in zip(g,g[1:]):
            tot+=math.hypot((b["lat"]-a["lat"])*111.0,(b["lon"]-a["lon"])*111.0*math.cos(math.radians(a["lat"])))
    out.write(f"{name}\t{len(ways)}\t{tot:.1f}\t{vis}\t{sac}\t{inf}\t{note}\n"); out.flush()
    time.sleep(1)
out.write("DONE\n"); out.close()
