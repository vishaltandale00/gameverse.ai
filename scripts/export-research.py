#!/usr/bin/env python3
"""Export public research summaries only. Requires existing PyYAML + NumPy tooling.
Usage: python scripts/export-research.py /path/to/research-checkout
No ROM bytes, screenshots, credentials, raw vectors or machine paths are exported.
"""
import hashlib,json,re,subprocess,sys
from datetime import datetime,timezone
from pathlib import Path
import yaml
source=Path(sys.argv[1]).resolve(); target=Path(__file__).resolve().parents[1]/'games'/'research.json'
source_only='--source-only' in sys.argv[2:]
if '--output' in sys.argv[2:]: target=Path(sys.argv[sys.argv.index('--output')+1]).resolve()
previous=json.loads(target.read_text()) if target.exists() else {}
rom_path=source/'local/re/roms.json'; space_path=source/'local/embeddings/game_space.json'; vectors_path=source/'local/embeddings/views.npz'; viewer_path=source/'local/embeddings/viewer_data.json'
if source_only:
    if not previous.get('views'): raise ValueError('A retained embedding snapshot is required for source-only refresh.')
    old_games={g['id']:g for g in previous['games']}
    roms=json.loads(rom_path.read_text()) if rom_path.exists() else [{'id':g['id'],'game_code':g['gameCode'],'sha1':g['romSha1'],'file':g['name']} for g in previous['games']]
    labels={gid:{'name':g['shortName'],'title':g['name']} for gid,g in old_games.items()}
    inputs={k:v for k,v in previous.get('inputs',{}).items() if not k.startswith('ontology/')}
    if rom_path.exists(): inputs[str(rom_path.relative_to(source))]=hashlib.sha256(rom_path.read_bytes()).hexdigest()
else:
    import numpy as np
    roms=json.loads(rom_path.read_text()); space=json.loads(space_path.read_text()); vectors=np.load(vectors_path)
    viewer=json.loads(viewer_path.read_text()); labels={g['id']:g for g in viewer['games']}
    inputs={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [rom_path,space_path,vectors_path,viewer_path]}
def clean(value):
    value=re.sub(r'/(?:Users|home|private|tmp|var/folders)/[^\s;)]+','[local reference]',str(value))
    value=re.sub(r'\bsk-[A-Za-z0-9_-]{16,}','[redacted]',value)
    return value[:799]+'…' if len(value)>800 else value
def public(value):
    if isinstance(value,str): return clean(value)
    if isinstance(value,list): return [public(v) for v in value]
    if isinstance(value,dict): return {k:public(v) for k,v in value.items()}
    return value
def portrait_summary(raw):
    identity=raw.get('identity',{})
    identity={k:identity[k] for k in ('tagline','tagline_status','categories','view','vibe','vibe_status','grounded_examples','gameplay_prior','category_basis') if k in identity}
    if isinstance(identity.get('view'),dict): identity['view']={k:v for k,v in identity['view'].items() if k in ('label','status')}
    pieces=[]
    for piece in raw.get('pieces',[]):
        out={k:piece[k] for k in ('id','label','slot','effect','flavor','component_refs','requires','exposes','conflicts','bridge_options','status','assembly_status') if k in piece}
        out['evidence']=[{k:v for k,v in e.items() if k in ('kind','ref','scope','file_sha256','span_sha256','source_evidence')} for e in piece.get('evidence',[])[:3]]
        pieces.append(out)
    story=raw.get('story',{})
    coverage=raw.get('coverage',{})
    return public({'identity':identity,'pieces':pieces,'story':story,'coverage':{k:coverage[k] for k in ('status','depth','canonical_component_count','source_supported_piece_count','missing','not_claimed') if k in coverage},'recordedAt':raw.get('provenance',{}).get('recorded_at')})
games=[]
source_files=[]
for rom in roms:
    gid=rom['id']; path=source/'ontology/games'/f'{gid}.yaml'; onto=yaml.safe_load(path.read_text()) if path.exists() else {}
    if path.exists(): inputs[str(path.relative_to(source))]=hashlib.sha256(path.read_bytes()).hexdigest(); source_files.append(path)
    sources=[clean(s.get('ref','')) for s in onto.get('game',{}).get('sources',[]) if s.get('kind')=='decomp']
    components=[]
    for c in onto.get('components',[]):
        evidence=[{'kind':e.get('kind','unknown'),'ref':clean(e.get('ref',''))} for e in c.get('evidence',[])[:3]]
        components.append({'id':c['id'],'facet':c.get('facet','mechanics'),'label':c.get('label',c['id']),'summary':clean(c.get('summary','')),'reads':c.get('reads',[])[:8],'writes':c.get('writes',[])[:8],'evidence':evidence})
    portrait_path=source/'ontology/portraits'/f'{gid}.json'
    portrait=portrait_summary(json.loads(portrait_path.read_text())) if portrait_path.exists() else None
    if portrait_path.exists(): inputs[str(portrait_path.relative_to(source))]=hashlib.sha256(portrait_path.read_bytes()).hexdigest(); source_files.append(portrait_path)
    label=labels.get(gid,{})
    games.append({'id':gid,'name':onto.get('game',{}).get('title',label.get('title',rom['file'].replace(' (USA).gba',''))),'shortName':label.get('name',gid.replace('-',' ').title()),'gameCode':rom['game_code'],'romSha1':rom['sha1'],'genres':onto.get('game',{}).get('derived_genres',[]),'components':components,'sourceReferences':sources,'ontologyPath':f'ontology/games/{gid}.yaml' if onto else None,'portrait':portrait})
if source_only:
    views=previous['views']
else:
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
try: source_commit=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True,stderr=subprocess.DEVNULL).strip()
except subprocess.CalledProcessError: source_commit=previous.get('sourceCommit','unavailable')
result={'schemaVersion':1,'snapshotDate':datetime.now(timezone.utc).date().isoformat(),'sourceCommit':source_commit,'description':'Partial research snapshot; component records retain their original evidence quality. Embedding proximity is similarity, not validated compatibility. Model revision for cached embeddings was not recorded.','inputs':inputs,'games':games,'views':views}
result['embeddingSourceCommit']=previous.get('embeddingSourceCommit',previous.get('sourceCommit')) if source_only else result['sourceCommit']
result['embeddingSnapshotDate']=previous.get('embeddingSnapshotDate',previous.get('snapshotDate')) if source_only else result['snapshotDate']
result['updatedAt']=datetime.fromtimestamp(max((p.stat().st_mtime for p in source_files),default=target.stat().st_mtime if target.exists() else 0),timezone.utc).isoformat()
result['exportedAt']=datetime.now(timezone.utc).isoformat()
result['researchVersion']=hashlib.sha256(json.dumps(inputs,sort_keys=True).encode()).hexdigest()
pieces=[p for g in games if g.get('portrait') for p in g['portrait']['pieces']]
result['counts']={'games':len(games),'canonicalGames':sum(bool(g['components']) for g in games),'components':sum(len(g['components']) for g in games),'portraits':sum(bool(g.get('portrait')) for g in games),'pieces':len(pieces),'sourceSupportedPieces':sum(p.get('status')=='source_supported_partial' for p in pieces),'observedPieces':sum(p.get('status')=='observed_interpretation' for p in pieces),'unverifiedPieces':sum(p.get('status') in ('candidate_unverified','model_prior_unverified') for p in pieces)}
result=public(result)
temporary=target.with_suffix('.json.tmp'); temporary.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n'); temporary.replace(target)
print(f'{len(games)} games; {sum(len(g["components"]) for g in games)} components; {len(views)} views; {target.stat().st_size} bytes')
