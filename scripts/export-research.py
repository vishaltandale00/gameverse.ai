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
    inputs={k:v for k,v in previous.get('inputs',{}).items() if not k.startswith(('ontology/','research/','tools/behavior_ir/examples/'))}
    if rom_path.exists(): inputs[str(rom_path.relative_to(source))]=hashlib.sha256(rom_path.read_bytes()).hexdigest()
else:
    import numpy as np
    roms=json.loads(rom_path.read_text()); space=json.loads(space_path.read_text()); vectors=np.load(vectors_path)
    viewer=json.loads(viewer_path.read_text()); labels={g['id']:g for g in viewer['games']}
    inputs={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [rom_path,space_path,vectors_path,viewer_path]}
def clean(value,limit=800):
    value=re.sub(r'/(?:Users|home|private|tmp|var/folders)/[^\s;)]+','[local reference]',str(value))
    value=re.sub(r'\bsk-[A-Za-z0-9_-]{16,}','[redacted]',value)
    return value[:limit-1]+'…' if limit is not None and len(value)>limit else value
def public(value,limit=800):
    if isinstance(value,str): return clean(value,limit)
    if isinstance(value,list): return [public(v,limit) for v in value]
    if isinstance(value,dict): return {k:public(v,None if k in ('recoveredSystems','executableComponents','compositionContracts','assemblyExamples','assemblyPatterns','assemblyPatternMetadata','recoveredPrefabManifest','recoveredPrefabDeliveries','reconstructionPairings','reconstructionAdapters') else limit) for k,v in value.items()}
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
    coverage=dict(raw.get('coverage',{}))
    progress=coverage.get('research_progress')
    if isinstance(progress,dict): coverage['research_progress']={k:progress[k] for k in ('campaign_id','recorded_at','status','function_records','pseudo_c_generated','process_wall_s','queue_s','scope','whole_game_decompiled','mechanic_validation','gaps','failure','reviewed_operator_count','semantic_review_ref') if k in progress}
    return public({'identity':identity,'pieces':pieces,'story':story,'coverage':{k:coverage[k] for k in ('status','depth','canonical_component_count','source_supported_piece_count','missing','not_claimed','research_progress') if k in coverage},'recordedAt':raw.get('provenance',{}).get('recorded_at')})
games=[]
exporter_path=Path(__file__).resolve()
inputs['scripts/export-research.py']=hashlib.sha256(exporter_path.read_bytes()).hexdigest()
source_files=[exporter_path]
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
# Read-only source-backed ontology view; executable fragments are not inferred systems.
recovered_path=source/'ontology/recovered-systems/index.json'
recovered_systems={'systems':[]}
if recovered_path.exists():
    recovered_bytes=recovered_path.read_bytes(); recovered_systems=json.loads(recovered_bytes)
    inputs[str(recovered_path.relative_to(source))]=hashlib.sha256(recovered_bytes).hexdigest(); source_files.append(recovered_path)
component_root=source/'ontology/executable-components'; component_index_path=component_root/'index.json'
executable_components=[]
executable_component_index=None
if component_index_path.exists():
    # Watch all source JSON identities, while publishing only catalog-indexed records.
    component_bytes={}
    for path in sorted(component_root.glob('*.json')):
        data=path.read_bytes(); component_bytes[path.name]=data
        inputs[str(path.relative_to(source))]=hashlib.sha256(data).hexdigest(); source_files.append(path)
    component_index=json.loads(component_bytes['index.json'])
    for entry in component_index.get('entries',[]):
        name=entry['record']
        if not re.fullmatch(r'[a-z0-9._-]+\.json',name): raise ValueError('Invalid executable component record path')
        if name not in component_bytes:
            path=component_root/name; data=path.read_bytes(); component_bytes[name]=data
            inputs[str(path.relative_to(source))]=hashlib.sha256(data).hexdigest(); source_files.append(path)
        record=json.loads(component_bytes[name])
        # Preserve the canonical published contract as the schema grows; no private package bytes are read.
        out={k:v for k,v in record.items() if k not in ('installed','availability')}
        out['recordPath']=str((component_root/name).relative_to(source)); out['availability']='not_checked_source_only'
        executable_components.append(out)
    executable_component_index={'schema':component_index.get('schema'),'scope':component_index.get('scope'),'recordCount':len(executable_components),'sourcePath':'ontology/executable-components/index.json','sourceSha256':inputs['ontology/executable-components/index.json']}
composition_contracts_path=source/'ontology/composition-contracts/index.json'
composition_contracts=None
if composition_contracts_path.exists():
    data=composition_contracts_path.read_bytes(); composition_contracts=json.loads(data)
    inputs[str(composition_contracts_path.relative_to(source))]=hashlib.sha256(data).hexdigest(); source_files.append(composition_contracts_path)
reconstruction_pairings=[]
reconstruction_adapters=[]
curated_ref='research/ir-workshop/reconstruction-interoperability-20261016/curated-pairings.json'
curated_path=source/curated_ref
if curated_path.exists():
    data=curated_path.read_bytes(); curated=json.loads(data)
    if curated.get('schema')!='gameverse.reconstruction-pairings/1': raise ValueError('Invalid curated pairing schema')
    inputs[curated_ref]=hashlib.sha256(data).hexdigest(); source_files.append(curated_path)
    reconstruction_pairings=curated.get('pairings',[]); reconstruction_adapters=curated.get('adapters',[])
recovered_prefab_manifest=None
recovered_prefab_deliveries=[]
for relative,key in [('ontology/game-system-prefabs/manifest.json','manifest'),('ontology/game-system-prefabs/deliveries.json','registry')]:
    path=source/relative
    if not path.exists(): continue
    data=path.read_bytes(); payload=json.loads(data)
    inputs[relative]=hashlib.sha256(data).hexdigest(); source_files.append(path)
    if key=='manifest': recovered_prefab_manifest=payload
    else:
        for row in payload.get('deliveries',[]):
            ref=row['ref']
            if not isinstance(ref,str) or not (ref.startswith('research/') or re.fullmatch(r'ontology/game-system-prefabs/delivery-snapshots/[a-f0-9]{64}\.json',ref)) or not ref.endswith('.json') or '\\' in ref or any(part in ('','.','..') for part in ref.split('/')): raise ValueError('Invalid registered delivery reference')
            path=source/ref
            if path.resolve()!=path.absolute(): raise ValueError('Symlinked registered delivery reference')
            data=path.read_bytes(); digest=hashlib.sha256(data).hexdigest()
            if digest!=row['sha256'] or (ref.startswith('ontology/') and Path(ref).stem!=digest): raise ValueError('Registered delivery identity changed')
            inputs[ref]=digest; source_files.append(path)
            recovered_prefab_deliveries.append({**json.loads(data),'descriptorRef':ref,'descriptorSha256':digest,'sourceRef':row.get('sourceRef',ref),'sourceSha256':digest})
assembly_patterns=[]
assembly_pattern_metadata=None
patterns_path=source/'ontology/composition-contracts/patterns.json'
if patterns_path.exists():
    data=patterns_path.read_bytes(); patterns=json.loads(data)
    inputs[str(patterns_path.relative_to(source))]=hashlib.sha256(data).hexdigest(); source_files.append(patterns_path)
    assembly_patterns=patterns.get('patterns',[])
    assembly_pattern_metadata={k:v for k,v in patterns.items() if k!='patterns'}
assembly_examples=[]
for example_id,label,relative in [
    ('reaction-chain','Editable two-component wiring example (no game)','tools/behavior_ir/examples/reaction-assembly.json'),
    ('reaction-transfer','Editable reaction-state transfer (no game)','ontology/composition-contracts/examples/mzm-reaction-transfer.json'),
]:
    path=source/relative
    if path.exists():
        data=path.read_bytes(); graph=json.loads(data)
        inputs[relative]=hashlib.sha256(data).hexdigest(); source_files.append(path)
        assembly_examples.append({'id':example_id,'label':label,'graph':graph,'sourceRef':relative,'sourceSha256':inputs[relative]})
# Narrow public progress projection: never publish local package paths or raw L0.
progress_paths={
    'pipeline':'research/automatic-ir/status.json',
    'coverage':'research/automatic-ir/mario-mechanic-coverage.json',
    'targets':'research/deep-extraction/mario/mechanics-targets.json',
    'fleet':'research/deep-extraction/resume/dispatch-summary.json',
}
progress_sources={}
for key,relative in progress_paths.items():
    path=source/relative
    if path.exists():
        progress_sources[key]=json.loads(path.read_text())
        inputs[relative]=hashlib.sha256(path.read_bytes()).hexdigest(); source_files.append(path)
pipeline=progress_sources.get('pipeline',{}); coverage=progress_sources.get('coverage',{})
fleet=progress_sources.get('fleet',{}); targets=progress_sources.get('targets',{})
progress={
    'pipeline':{k:pipeline[k] for k in ('updated_utc','source_commit_at_snapshot','objective_status','rom_inventory','bounded_l0_exports','bounded_static_l1_candidates','retained_native_qualified_packages','original_function_package_subsets','unique_original_source_roots','domain_specialization_subset_packages','declared_linked_sequence_package_subsets','typed_port_subset_packages','retained_package_fixture_pairs','active_blockers') if k in pipeline},
    'mario':{'updatedAt':coverage.get('updated_utc'),'targets':len(targets['targets']) if 'targets' in targets else None,'openFamilies':sum(not f.get('coverage_complete',False) for g in coverage.get('games',[]) for f in g.get('families',[])) if 'games' in coverage else None,'games':len(coverage['games']) if 'games' in coverage else None},
    'fleet':{'updatedAt':fleet.get('updated_utc'),'readyPackets':sum(g.get('state')=='packet_ready' for g in fleet.get('games',[])) if 'games' in fleet else None,'scope':fleet.get('scope'),'games':[{k:g[k] for k in ('id','state','reported_status','next_action','packet','current_fleet_native_build_runs') if k in g} for g in fleet.get('games',[])]},
    'sources':[{'path':relative,'sha256':inputs[relative]} for relative in progress_paths.values() if relative in inputs],
}
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
result={'schemaVersion':1,'snapshotDate':datetime.now(timezone.utc).date().isoformat(),'sourceCommit':source_commit,'description':'Partial research snapshot; component records retain their original evidence quality. Embedding proximity is similarity, not validated compatibility. Model revision for cached embeddings was not recorded.','inputs':inputs,'games':games,'views':views,'progress':progress,'recoveredSystems':recovered_systems,'executableComponents':executable_components,'executableComponentIndex':executable_component_index,'compositionContracts':composition_contracts,'assemblyExamples':assembly_examples,'assemblyPatterns':assembly_patterns,'assemblyPatternMetadata':assembly_pattern_metadata,'recoveredPrefabManifest':recovered_prefab_manifest,'recoveredPrefabDeliveries':recovered_prefab_deliveries,'reconstructionPairings':reconstruction_pairings,'reconstructionAdapters':reconstruction_adapters}
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
