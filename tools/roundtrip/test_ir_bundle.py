"""Focused IR-bundle input and read-denial checks; no compiler/native campaigns."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from .ir_bundle import read_ref, binding_from_snapshot, load_recipe, load_asset_partition


class IRBundleInputs(unittest.TestCase):
    def test_stale_semantic_pin_and_path_escape_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'l1.json').write_bytes(b'{"body":[]}')
            correct=hashlib.sha256((root/'l1.json').read_bytes()).hexdigest()
            self.assertEqual(read_ref(root,{'path':'l1.json','sha256':correct}),b'{"body":[]}')
            (root/'l1.json').write_bytes(b'{"body":[{"op":"return"}]}')
            with self.assertRaisesRegex(ValueError,'pin mismatch'):read_ref(root,{'path':'l1.json','sha256':correct})
            with self.assertRaises(ValueError):read_ref(root,{'path':'../outside.json','sha256':correct})

    def test_missing_mechanical_binding_closure_fails(self):
        with self.assertRaisesRegex(ValueError,'closure unavailable'):
            binding_from_snapshot('def binding(adapter,label): return ""\n')

    def test_unqualified_or_unknown_recipe_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'ir-bundle.json').write_text(json.dumps({'schema':'unqualified','recipe':'arbitrary-command','modules':[]}))
            with self.assertRaisesRegex(ValueError,'unsupported qualified IR recipe'):load_recipe(root)

    def test_asset_partition_generic_count_and_negative_extents(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);overlay=root/'overlay';overlay.mkdir();assembly=overlay/'assembly';assembly.mkdir()
            recipe={'container':{'sha256':'parent'},'expected_artifact':{'sha256':'candidate','size':9}}
            asset={'id':'palette','type':'asset_data','original_offset':2,'size':3,'sha256':'data',
                   'source_pins':{'declaration':'pinned'},'consumers':[{'typed':True}],'elf_symbol':'palette'}
            record={'schema':'gameverse.private-bundle-assets/1','status':'passed','bundle_manifest_sha256':'parent',
                    'assets':[asset],'asset_data_bytes':3}
            layout={'artifact':{'sha256':'candidate','size':9},'components':[
                {'offset':0,'size':2,'content_type':'mixed_unknown','sha256':'mixed'},
                {'offset':2,'size':3,'content_type':'asset_data','sha256':'data'},
                {'offset':5,'size':4,'content_type':'mixed_unknown','sha256':'payload'}]}
            def save():
                raw=json.dumps(record).encode();(overlay/'asset-overlay.json').write_bytes(raw)
                data=json.dumps(layout).encode();(assembly/'layout.json').write_bytes(data)
                receipt={'schema':'gameverse.private-assets-rebuild/1','status':'passed','consumed_by_rebuild':True,
                    'asset_overlay_sha256':hashlib.sha256(raw).hexdigest(),'artifact':{'sha256':'candidate'},'asset_bytes':3,
                    'layout':{'path':str(assembly/'layout.json'),'sha256':hashlib.sha256(data).hexdigest()}}
                (overlay/'asset-rebuild-receipt.json').write_text(json.dumps(receipt))
            save();admitted=load_asset_partition(overlay,root,recipe)
            self.assertEqual(admitted['asset_bytes'],3)
            self.assertEqual(admitted['asset_ids'],['palette'])
            asset['original_offset']=1;save()
            with self.assertRaises(ValueError):load_asset_partition(overlay,root,recipe)
            asset['original_offset']=2;layout['components'][1]['content_type']='mixed_unknown';save()
            with self.assertRaises(ValueError):load_asset_partition(overlay,root,recipe)
            layout['components'][1]['content_type']='asset_data';record['assets'].append(dict(asset));save()
            with self.assertRaises(ValueError):load_asset_partition(overlay,root,recipe)

    def test_isolated_guard_denies_existing_original_old_c_and_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);bundle=root/'bundle';output=root/'out';bundle.mkdir();output.mkdir()
            original=root/'original.gba';original.write_bytes(b'private original')
            checkout=root/'source.c';checkout.write_bytes(b'private source')
            old_c=bundle/'old-generated.c';old_c.write_bytes(b'old emitted C')
            payload=bundle/'old-payload.bin';payload.write_bytes(b'old native payload')
            alias=bundle/'alias-to-old-c';alias.symlink_to(old_c)
            denied_parent=bundle/'denied-parent';denied_parent.mkdir();descendant=denied_parent/'child.bin';descendant.write_bytes(b'private descendant')
            positive=bundle/'allowed.txt';positive.write_text('allowed input')
            layout=bundle/'layout.json';layout.write_text(json.dumps({'components':[{'providerKind':'ir_generated','artifact':{'path':'old-payload.bin'}}]}))
            recipe={'layout':{'path':'layout.json','sha256':hashlib.sha256(layout.read_bytes()).hexdigest()},'compiler':{},
                    'access_policy':{'denied_roots':[],'denied_files':[str(original),str(checkout),str(old_c),str(denied_parent)],
                                     'negative_controls':[str(original),str(checkout),str(old_c),str(payload),str(alias),str(descendant)]}}
            script=('from pathlib import Path\nfrom tools.roundtrip.ir_bundle import install_read_guard\nimport json\n'
                    +'r=install_read_guard(Path('+repr(str(bundle))+'),Path('+repr(str(output))+'),'+repr(recipe)+')\n'
                    +'r["positive"]=Path('+repr(str(positive))+').read_text()\n'
                    +'print(json.dumps(r))\n')
            process=subprocess.run([sys.executable,'-B','-c',script],capture_output=True,text=True,timeout=10)
            self.assertEqual(process.returncode,0,process.stderr)
            report=json.loads(process.stdout)
            self.assertEqual([x['result'] for x in report['negative_controls']],['denied']*6)
            self.assertEqual(report['positive'],'allowed input')
            self.assertFalse(report['compiler_subprocess_os_confined'])


if __name__=='__main__':unittest.main()
