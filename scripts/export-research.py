#!/usr/bin/env python3
"""Export public research summaries only. Requires existing PyYAML + NumPy tooling.
Usage: python scripts/export-research.py /path/to/research-checkout
No ROM bytes, screenshots, credentials, raw vectors or machine paths are exported.
"""
import hashlib,json,re,subprocess,sys
from pathlib import Path
import numpy as np
import yaml
source=Path(sys.argv[1]).resolve(); target=Path(__file__).resolve().parents[1]/'games'/'research.json'
rom_path=source/'local/re/roms.json'; space_path=source/'local/embeddings/game_space.json'; vectors_path=source/'local/embeddings/views.npz'; viewer_path=source/'local/embeddings/viewer_data.json'
roms=json.loads(rom_path.read_text()); space=json.loads(space_path.read_text()); vectors=np.load(vectors_path)
viewer=json.loads(viewer_path.read_text()); labels={g['id']:g for g in viewer['games']}
inputs={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [rom_path,space_path,vectors_path,viewer_path]}
def clean(value):
    value=re.sub(r'/Users/[^\s;)]+','[local reference]',str(value))
    return value[:799]+'…' if len(value)>800 else value
games=[]
for rom in roms:
    gid=rom['id']; path=source/'ontology/games'/f'{gid}.yaml'; onto=yaml.safe_load(path.read_text()) if path.exists() else {}
    if path.exists(): inputs[str(path.relative_to(source))]=hashlib.sha256(path.read_bytes()).hexdigest()
    sources=[clean(s.get('ref','')) for s in onto.get('game',{}).get('sources',[]) if s.get('kind')=='decomp']
    components=[]
    for c in onto.get('components',[]):
        evidence=[{'kind':e.get('kind','unknown'),'ref':clean(e.get('ref',''))} for e in c.get('evidence',[])[:3]]
        components.append({'id':c['id'],'facet':c.get('facet','mechanics'),'label':c.get('label',c['id']),'summary':clean(c.get('summary','')),'reads':c.get('reads',[])[:8],'writes':c.get('writes',[])[:8],'evidence':evidence})
    label=labels.get(gid,{})
    games.append({'id':gid,'name':onto.get('game',{}).get('title',label.get('title',rom['file'].replace(' (USA).gba',''))),'shortName':label.get('name',gid.replace('-',' ').title()),'gameCode':rom['game_code'],'romSha1':rom['sha1'],'genres':onto.get('game',{}).get('derived_genres',[]),'components':components,'sourceReferences':sources,'ontologyPath':f'ontology/games/{gid}.yaml' if onto else None})
views={}
ids=[g['id'] for g in games]
for key,view in space['views'].items():
    # Existing map has 18 independent views; do not create fresh model calls or layouts.
    if not all(gid in view['xy'] for gid in ids):continue
    X=np.stack([vectors[f'{key}|{gid}'] for gid in ids]).astype(float)
    if not key.startswith('rendering_measured'):
        X=X-X.mean(0);X=X/(np.linalg.norm(X,axis=1,keepdims=True)+1e-9)
    D=np.linalg.norm(X[:,None]-X[None,:],axis=-1); D=D/D.max() if D.max() else D
    neighbors={}
    for i,gid in enumerate(ids):
        ranked=sorted((j for j in range(len(ids)) if j!=i),key=lambda j:float(D[i,j]))
        neighbors[gid]={'near':[{'id':ids[j],'distance':round(float(D[i,j]),4)} for j in ranked[:3]],'far':[{'id':ids[j],'distance':round(float(D[i,j]),4)} for j in ranked[-3:][::-1]]}
    views[key]={'label':viewer['views'].get(key,{}).get('label',key.replace('text:','').replace('_',' ').title()),'provenance':space['provenance'].get(key,'Unknown'),'basis':('model_recall' if key.startswith('text:') else 'model_classification' if key in ('frontend_measured','projection_measured') else 'capture_embedding' if key in ('audio','visual_style') else 'capture_telemetry'),'xy':view['xy'],'clusters':view['clusters'],'neighbors':neighbors,'lowCoverage':space.get('low_coverage',{}).get(key,{})}
result={'schemaVersion':1,'snapshotDate':'2026-10-16','sourceCommit':subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip(),'description':'Partial research snapshot; component records retain their original evidence quality. Embedding proximity is similarity, not validated compatibility. Model revision for cached embeddings was not recorded.','inputs':inputs,'games':games,'views':views}
target.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
print(f'{len(games)} games; {sum(len(g["components"]) for g in games)} components; {len(views)} views; {target.stat().st_size} bytes')
