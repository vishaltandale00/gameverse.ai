"""Pinned source-derived entry/expected-state cases, never behavior input."""
import hashlib,json

def load(path,adapter):
 evidence=json.loads(path.read_text())
 encoded=(json.dumps(adapter,indent=2)+'\n').encode()
 if evidence['adapter_sha256']!=hashlib.sha256(encoded).hexdigest()or evidence['l0_sha256']!=adapter['l0_sha256']:raise ValueError('causal fixture no longer matches exact L0/adapter')
 if evidence.get('schema')=='gameverse.ir.causal-port-fixtures/1':
  return evidence['fixture_data']
 names={f['name']for f in adapter['fields']};states=[];expected=[]
 for case in evidence['cases']:
  initial=case['input_fields'];final=dict(initial);final.update(case['expected_changed_fields'])
  if set(initial)!=names or set(case['expected_changed_fields'])|set(case['expected_unchanged_fields'])!=names:raise ValueError('causal fixture must cover every admitted state field')
  if set(case['expected_changed_fields'])&set(case['expected_unchanged_fields']):raise ValueError('causal fixture fields disagree')
  states.append(initial);expected.append(final)
 return {'states':states,'expected_states':expected,'context':{'source_evidence':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'case_ids':[c['id']for c in evidence['cases']],'scope':'source-derived correlated entry cases; original CPU and generated CPU must match exact expected states; not a full gameplay campaign'}}

def digest(fixtures):return hashlib.sha256(json.dumps(fixtures,sort_keys=True).encode()).hexdigest()if fixtures else None
