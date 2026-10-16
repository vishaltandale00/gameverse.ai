"""Extract address-free default data for observed read-only ROM context objects.
Source offsets are adapter-only; packages contain symbolic values and opaque hashes.
"""
import hashlib

def configurations(l1,adapter,rom,profile):
 results=[]
 for ref in adapter.get('object_references',[]):
  contract=profile.get('object_contract',{}).get(f"{ref['cell']:08x}",{})
  if contract.get('storage')!='readonly_rom':continue
  for index,base in enumerate(contract['observed_targets']):
   fields={};collections={};source=bytearray()
   for f in adapter['fields']:
    if f.get('reference')!=ref['name']:continue
    start=base+f['offset']-0x08000000;width=f['width']//8
    if not 0<=start<=len(rom)-width:raise ValueError('source configuration outside ROM')
    data=rom[start:start+width];source.extend(data);fields[f['name']]=int.from_bytes(data,'little')
   for c in adapter.get('collections',[]):
    if c.get('reference')!=ref['name']:continue
    start=base+c['offset']-0x08000000;width=c['size'];end=start+width*c['count']
    if not 0<=start<=end<=len(rom):raise ValueError('source configuration collection outside ROM')
    data=rom[start:end];source.extend(data);collections[c['name']]=[int.from_bytes(data[i:i+width],'little')for i in range(0,len(data),width)]
   results.append({'id':'source_profile_'+str(index),'label':contract.get('configuration_labels',{}).get(str(base),'Observed source profile '+str(index)),'fields':fields,'collections':collections,'source_data_sha256':hashlib.sha256(source).hexdigest(),'source_rom_sha256':hashlib.sha256(rom).hexdigest(),'provenance':{'kind':'observed_readonly_ROM_object','evidence':contract['evidence'],'machine_layout':'validation_adapter_only'}})
 return results
