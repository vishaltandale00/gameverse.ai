#!/usr/bin/env python3
"""Lower versioned composition plans into isolated, identity-pinned GBA ROMs.

Native v1 is deliberately small: closed freestanding C packages, typed Thumb
entry replacement, immutable ROM data/global argument bindings. Unknown contracts
fail before compilation. It does not use source string substitutions or patches.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import re
import subprocess
import shutil
import time
from .resolve import resolve

ROOT = Path(__file__).resolve().parents[2]
VERSION = 'gba-component-native/1'
TYPES = {'ptr': 'void *', 'u32': 'uint32_t', 'i32': 'int32_t',
         'u16': 'uint16_t', 'i16': 'int16_t'}
SYMBOL = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def exact_keys(row, allowed, required=()):
    if set(row) - set(allowed) or set(required) - set(row):
        raise ValueError('Unsupported or missing contract fields: ' + str(sorted(row)))


def integer(value):
    if isinstance(value, bool):
        raise ValueError('Boolean is not an integer')
    if not isinstance(value, (str, int)):
        raise ValueError('Expected exact integer')
    return int(value, 0) if isinstance(value, str) else value


def repository_file(ref):
    path = (ROOT / ref).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        raise ValueError('Expected existing repository file: ' + str(ref))
    return path


def pinned_file(record):
    exact_keys(record, ['ref', 'sha256'], ['ref', 'sha256'])
    path = repository_file(record['ref'])
    if sha(path.read_bytes()) != record['sha256']:
        raise ValueError('Pinned file hash mismatch: ' + record['ref'])
    return path


def identifier(value):
    if not isinstance(value, str) or not SYMBOL.fullmatch(value):
        raise ValueError('Invalid native identifier: ' + str(value))
    return value


def validate(doc, rom):
    static = resolve(doc)
    if doc.get('bindings') or doc.get('transforms') or doc.get('execution', {}).get('transitions'):
        raise ValueError('Native v1 requires packaged executable transforms/transitions; declarative port graphs not lowered yet')
    if any(o['code'] == 'UNSUPPORTED_FIELD' for o in static['obligations']):
        raise ValueError('Unknown IR field has no executable lowering')
    if static['errors']:
        raise ValueError('IR conflicts: ' + json.dumps(static['errors']))
    spec = doc['native_build']
    exact_keys(spec, ['version', 'host', 'packages', 'hooks', 'max_payload_bytes', 'timeout_s', 'max_build_s'],
               ['version', 'host', 'packages', 'hooks', 'max_payload_bytes', 'timeout_s'])
    if spec['version'] != VERSION:
        raise ValueError('Unsupported native backend version')
    host_path = pinned_file(spec['host'])
    host = json.loads(host_path.read_text())
    exact_keys(host, ['version', 'game_id', 'rom_sha256', 'rom_sha1', 'rom_bytes',
                     'append_address', 'output_bytes', 'hooks', 'abi', 'campaign', 'services'],
               ['version', 'game_id', 'rom_sha256', 'rom_sha1', 'rom_bytes',
                'append_address', 'output_bytes', 'hooks', 'abi', 'campaign'])
    if host['version'] != 'gba-thumb-host/1' or host['abi'] != 'aapcs-arm7tdmi-thumb-leaf-replacement':
        raise ValueError('Unknown native host ABI')
    if sha(rom) != host['rom_sha256'] or hashlib.sha1(rom).hexdigest() != host['rom_sha1'] or len(rom) != host['rom_bytes']:
        raise ValueError('Foundation ROM identity mismatch')
    if integer(host['append_address']) != 0x08000000 + len(rom):
        raise ValueError('Payload must append after entire retained cartridge')
    if host['output_bytes'] not in (1<<23, 1<<24, 1<<25) or host['output_bytes'] <= len(rom):
        raise ValueError('Invalid native output cartridge size')
    if not 1 <= spec.get('max_build_s', 60) <= 300:
        raise ValueError('Total native build budget must be1..300 seconds')
    if not 1 <= spec['timeout_s'] <= 60 or not 1 <= spec['max_payload_bytes'] <= 1048576:
        raise ValueError('Finite native build limits required')
    if not 1 <= len(spec['packages']) <= 64 or not 1 <= len(spec['hooks']) <= 128:
        raise ValueError('Native graph exceeds bounded instance/hook limits')
    components = {r['id']: r for r in doc['components']}
    if not components:
        raise ValueError('No selected components')
    packages = {}
    source_pins = {}
    for selection in spec['packages']:
        exact_keys(selection, ['instance', 'package'], ['instance', 'package'])
        instance = identifier(selection['instance'])
        if instance in packages or instance not in components:
            raise ValueError('Duplicate/undeclared component instance')
        path = pinned_file(selection['package'])
        package = json.loads(path.read_text())
        if package.get('kind') != 'component_package' or package.get('ir_version') != '0.1':
            raise ValueError('Expected versioned IR component package')
        recovery = package['native_implementation']['recovery']
        if package['native_implementation']['origin'] not in ('self_decompilation', 'new_bridge') or recovery['dependency_closure']['status'] != 'closed':
            raise ValueError('Own recovered component or explicit new bridge with closed native dependencies required')
        if recovery['rom_sha256'] != sha(rom) and not recovery.get('dynamic_witness_refs'):
            raise ValueError('Cross-ROM component requires recovery witnesses')
        if recovery['rom_sha256'] == sha(rom):
            for span in recovery['ranges']:
                offset = integer(span['address']) - 0x08000000
                if offset < 0 or offset + span['size'] > len(rom) or sha(rom[offset:offset+span['size']]) != span['instruction_sha256']:
                    raise ValueError('Recovered original instruction range mismatch')
        native = package['lowering']['native_v1']
        exact_keys(native, ['version', 'sources', 'translation_units', 'exports', 'requires', 'state_bindings', 'host_calls', 'host_reads'],
                   ['version', 'sources', 'translation_units', 'exports', 'requires', 'state_bindings'])
        if native['version'] != 'freestanding-c-thumb/1':
            raise ValueError('Unsupported package lowering')
        if not set(native['translation_units']) <= {s['ref'] for s in native['sources']}:
            raise ValueError('Translation unit missing immutable source pin')
        for source in native['sources']:
            pinned_file(source)
            old = source_pins.setdefault(source['ref'], source['sha256'])
            if old != source['sha256']:
                raise ValueError('Conflicting source identities')
        exports = {}
        for export in native['exports']:
            exact_keys(export, ['symbol', 'return', 'args', 'constant_choices'], ['symbol', 'return', 'args'])
            symbol = identifier(export['symbol'])
            if export['return'] not in ('void', 'i32') or len(export['args']) > 4 or any(t not in TYPES for t in export['args']) or symbol in exports:
                raise ValueError('Unsupported native export ABI')
            exports[symbol] = export
        validate_states(native['state_bindings'])
        packages[instance] = {'document': package, 'pin': selection['package'], 'native': native, 'exports': exports}
    services = {}
    for service in host.get('services', []):
        exact_keys(service, ['id', 'address', 'isa', 'abi', 'preimage', 'range_size', 'range_sha256'], ['id', 'address', 'isa', 'abi', 'preimage'])
        address = integer(service['address'])
        offset = address - 0x08000000
        preimage = bytes.fromhex(service['preimage'])
        if service['id'] in services or service['isa'] != 'thumb' or address % 2 or not service['abi'] or not preimage or offset < 0 or offset+len(preimage) > len(rom) or rom[offset:offset+len(preimage)] != preimage:
            raise ValueError('Invalid native retained-service contract')
        if 'range_size' in service or 'range_sha256' in service:
            size = integer(service['range_size'])
            if size < len(preimage) or offset+size > len(rom) or sha(rom[offset:offset+size]) != service['range_sha256']:
                raise ValueError('Retained native service range mismatch')
        services[service['id']] = service
    for package in packages.values():
        for read in package['native'].get('host_reads', []):
            if read not in host['campaign'].get('argument_reads', []):
                raise ValueError('Unresolved package native global read')
        for call in package['native'].get('host_calls', []):
            exact_keys(call, ['service', 'address', 'abi'], ['service', 'address', 'abi'])
            service = services.get(call['service'])
            if service is None or integer(call['address']) != integer(service['address']) or call['abi'] != service['abi']:
                raise ValueError('Unresolved native retained-service call')
    if set(packages) != set(components):
        raise ValueError('Every declared component needs a selected native package')
    # Selected dependencies are exact package ID+version, never an unpinned path.
    present = {(p['document']['id'], p['document']['version']) for p in packages.values()}
    for package in packages.values():
        for dependency in package['native']['requires']:
            exact_keys(dependency, ['id', 'version'], ['id', 'version'])
            if (dependency['id'], dependency['version']) not in present:
                raise ValueError('Missing native dependency: ' + str(dependency))
    host_hooks = {}
    for hook in host['hooks']:
        exact_keys(hook, ['id', 'address', 'preimage', 'cardinality', 'abi', 'phase', 'writes', 'args', 'return'],
                   ['id', 'address', 'preimage', 'cardinality', 'abi', 'phase', 'writes'])
        if hook['id'] in host_hooks or hook['cardinality'] != 1 or hook['abi'] not in ('r0-actor-void-thumb', 'r0-actor-i32-thumb', 'aapcs-thumb'):
            raise ValueError('Unknown/ambiguous native hook')
        if hook['abi']=='aapcs-thumb' and (hook.get('return') not in ('void','i32') or
                not isinstance(hook.get('args'),list) or len(hook['args'])>4 or
                any(t not in TYPES for t in hook['args'])):
            raise ValueError('Explicit bounded typed Thumb ABI required')
        address = integer(hook['address'])
        offset = address - 0x08000000
        size=len(bytes.fromhex(hook['preimage']))
        required_size=16 if hook['abi']=='aapcs-thumb' and len(hook['args'])==4 else 8
        if address % 4 or size != required_size or offset < 0 or offset + size > len(rom) or rom[offset:offset+size].hex() != hook['preimage']:
            raise ValueError('Native hook preimage/alignment mismatch')
        host_hooks[hook['id']] = hook
    if len(source_pins) > 128:
        raise ValueError('Native source closure exceeds128-file build bound')
    # Cyclic dependency declarations cannot stand in for closed assembly.
    by_identity = {(p['document']['id'], p['document']['version']): p for p in packages.values()}
    visiting, visited = set(), set()
    def visit(identity):
        if identity in visiting:
            raise ValueError('Native dependency cycle')
        if identity in visited:
            return
        visiting.add(identity)
        for dep in by_identity[identity]['native']['requires']:
            visit((dep['id'], dep['version']))
        visiting.remove(identity); visited.add(identity)
    for identity in by_identity:
        visit(identity)
    if len(by_identity) != len(packages):
        raise ValueError('Repeated package identity requires explicit instantiation backend')
    selected = []
    occupied = []
    for binding in spec['hooks']:
        exact_keys(binding, ['host_hook', 'instance', 'symbol', 'args'], ['host_hook', 'instance', 'symbol', 'args'])
        hook = host_hooks[binding['host_hook']]
        package = packages[binding['instance']]
        export = package['exports'][binding['symbol']]
        expected_return = hook['return'] if hook['abi']=='aapcs-thumb' else ('i32' if hook['abi'] == 'r0-actor-i32-thumb' else 'void')
        if export['return'] != expected_return:
            raise ValueError('Native hook return ABI mismatch')
        if len(binding['args']) != len(export['args']):
            raise ValueError('Native argument cardinality mismatch')
        for index, choices in export.get('constant_choices', {}).items():
            position = integer(index)
            if position < 0 or position >= len(export['args']) or export['args'][position] == 'ptr' or not choices or any(not isinstance(c, int) for c in choices):
                raise ValueError('Malformed native parameter choices')
            value = binding['args'][position]
            if set(value) != {'constant'} or integer(value['constant']) not in choices:
                raise ValueError('Native parameter outside declared semantic choices')
        if len(binding['args']) != len(export['args']):
            raise ValueError('Native argument cardinality mismatch')
        addr = integer(hook['address'])
        size=len(bytes.fromhex(hook['preimage']))
        if any(addr<other+other_size and other<addr+size for other,other_size in occupied):
            raise ValueError('Duplicate or overlapping hook authority')
        occupied.append((addr,size))
        for arg, expected_type in zip(binding['args'], export['args']):
            argument(arg, host, expected_type, hook)
        component = components[binding['instance']]
        for state in hook['writes']:
            if not any(a['state'] == state and a['phase'] == hook['phase'] and a['op'] == 'write' for a in component.get('accesses', [])):
                raise ValueError('Hook writer absent from resolved state authority')
        selected.append((binding, hook, export))
    if not selected:
        raise ValueError('Native composition must bind executable hooks')
    # All selected packages participate in the call graph, directly or via deps.
    used = {b['instance'] for b, _, _ in selected}
    for p in packages.values():
        for dep in p['native']['requires']:
            used.update(i for i, row in packages.items() if row['document']['id'] == dep['id'] and row['document']['version'] == dep['version'])
    if used != set(packages):
        raise ValueError('Unconsumed packages are not assembly evidence')
    return spec, host, packages, source_pins, selected, static


def validate_states(bindings):
    seen = set()
    for state in bindings:
        exact_keys(state, ['id', 'storage', 'bytes', 'lifetime', 'writes', 'allocation'],
                   ['id', 'storage', 'bytes', 'lifetime', 'writes', 'allocation'])
        identifier(state['id'])
        actor=state['storage']=='host-r0-actor' and state['lifetime']=='native-entity'
        task=state['storage']=='native-task-data' and state['lifetime']=='campaign'
        if state['id'] in seen or not (actor or task):
            raise ValueError('Unsupported or repeated native state binding')
        if task:
            a=state['allocation']
            exact_keys(a,['service','bytes','alignment','flags','priority','locator'],
                       ['service','bytes','alignment','flags','priority','locator'])
            if a['bytes']!=state['bytes'] or a['alignment']!=4 or a['flags']!=2 or not 0<a['priority']<65535 or not a['service'] or not a['locator']:
                raise ValueError('Campaign task allocation must declare native owner, finite size and persistent-task flag')
        seen.add(state['id'])
        if not isinstance(state['bytes'], int) or not 1 <= state['bytes'] <= 4096:
            raise ValueError('Native actor state extent outside supported range')
        end = 0
        for field in sorted(state['writes'], key=lambda row: row['offset']):
            exact_keys(field, ['offset', 'width', 'quantity'], ['offset', 'width', 'quantity'])
            offset, width = integer(field['offset']), integer(field['width'])
            if width not in (8, 16, 32) or offset < end or offset % (width//8) or offset+width//8 > state['bytes']:
                raise ValueError('Overlapping, misaligned or out-of-range native state field')
            end = offset + width//8


def state_header(packages):
    rows = ['#include <stdint.h>', '#include <stddef.h>',
            '/* Existing host storage only: generated layouts never allocate BSS. */']
    for instance, package in sorted(packages.items()):
        for state in package['native']['state_bindings']:
            name = 'gv_state_' + instance + '_' + state['id']
            rows.append('struct __attribute__((packed)) %s {' % name)
            end = 0
            fields = sorted(state['writes'], key=lambda row: row['offset'])
            for n, field in enumerate(fields):
                if field['offset'] > end:
                    rows.append('uint8_t reserved_%d[%d];' % (n, field['offset']-end))
                rows.append('uint%d_t field_%d;' % (field['width'], n))
                end = field['offset'] + field['width']//8
            if state['bytes'] > end:
                rows.append('uint8_t reserved_tail[%d];' % (state['bytes']-end))
            rows.append('};')
            rows.append('_Static_assert(sizeof(struct %s)==%d,"host state extent");' % (name,state['bytes']))
            for n, field in enumerate(fields):
                rows.append('_Static_assert(offsetof(struct %s,field_%d)==%d,"host field offset");' % (name,n,field['offset']))
    return '\n'.join(rows)+'\n'


def argument(arg, host, expected_type=None, hook=None):
    if set(arg) == {'arg'}:
        if hook and hook['abi']=='aapcs-thumb':
            index=integer(arg['arg'])
            if not 0<=index<len(hook['args']) or (expected_type is not None and hook['args'][index]!=expected_type):
                raise ValueError('Native input register absent or typed incompatibly')
            return 'r%d'%index
        if expected_type is not None and expected_type != 'ptr':
            raise ValueError('Actor pointer cannot bind scalar input')
        if arg['arg'] != 0:
            raise ValueError('Only reviewed actor register r0 is available')
        return 'actor'
    if set(arg) == {'constant'}:
        value = integer(arg['constant'])
        low, high = {'i32': (-0x80000000, 0x7fffffff), 'i16': (-32768, 32767), 'u16': (0, 65535)}.get(expected_type, (0, 0xffffffff))
        if not low <= value <= high:
            raise ValueError('Constant outside native input type')
        if expected_type == 'ptr' and value < 0x08000000:
            raise ValueError('Pointer constant must bind immutable ROM input')
        # ROM pointers must be listed as exact immutable host argument leases.
        if value >= 0x02000000:
            allowed = host['campaign'].get('argument_constants', [])
            if value not in [integer(x) for x in allowed]:
                raise ValueError('Undeclared native ROM/address argument')
        return str(value) if value < 0 else '0x%xu' % value
    if set(arg) == {'read'}:
        row = arg['read']
        exact_keys(row, ['address', 'width'], ['address', 'width'])
        if row not in host['campaign'].get('argument_reads', []):
            raise ValueError('Undeclared native global read')
        if expected_type == 'ptr':
            raise ValueError('Scalar global read cannot bind pointer input')
        if row['width'] not in (8, 16, 32):
            raise ValueError('Unsupported native read width')
        return '(*(volatile uint%d_t *)0x%xu)' % (row['width'], integer(row['address']))
    raise ValueError('Unknown native argument expression')


def build(plan, rom_path, out):
    out = Path(out).resolve()
    out.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    receipt = {'version': VERSION, 'id': plan.get('id'), 'outcome': 'running', 'stages': [],
               'queue_s': None, 'queue_note': 'Direct local invocation; no queue measurement',
               'mode': 'clean', 'cache': 'none', 'environment': platform.platform(),
               'backend_sha256': sha(Path(__file__).read_bytes()),
               'plan_sha256': sha(canonical(plan)), 'qualification': 'Native build only; gameplay qualification separate'}
    receipt_path = out / 'receipt.json'
    def save():
        receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
    deadline = started + plan.get('native_build', {}).get('max_build_s', 60)
    def command(label, argv, timeout):
        timeout = min(timeout, deadline-time.monotonic())
        if timeout <= 0:
            raise ValueError('Total native build time budget exhausted')
        begin = time.monotonic()
        try:
            result = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
            row = {'stage': label, 'wall_s': round(time.monotonic()-begin, 6), 'exit_code': result.returncode,
                   'command': argv, 'outcome': 'ok' if result.returncode == 0 else 'failed'}
            (out / (label + '.log')).write_text(result.stdout + result.stderr)
        except subprocess.TimeoutExpired:
            receipt['stages'].append({'stage': label, 'wall_s': round(time.monotonic()-begin, 6), 'outcome': 'timeout'})
            save()
            raise
        receipt['stages'].append(row)
        save()
        if result.returncode:
            raise ValueError('Native stage failed: ' + label)
        return result.stdout
    try:
        rom = Path(rom_path).read_bytes()
        spec, host, packages, sources, hooks, static = validate(plan, rom)
        receipt['limits'] = {'stage_timeout_s': spec['timeout_s'], 'max_build_s': spec.get('max_build_s', 60), 'max_payload_bytes': spec['max_payload_bytes']}
        receipt['source_commit'] = command('source-context', ['git', 'rev-parse', 'HEAD'], 3).strip()
        receipt['tool_binaries'] = {name: {'path': shutil.which(name), 'sha256': sha(Path(shutil.which(name)).resolve().read_bytes())} for name in ['cc', 'arm-none-eabi-ld', 'arm-none-eabi-objcopy']}
        receipt['compiler'] = command('toolchain', ['cc', '--version'], 3).splitlines()[0]
        receipt['host_sha256'] = sha(canonical(host))
        receipt['foundation_sha256'] = sha(rom)
        (out / 'host.json').write_bytes(pinned_file(spec['host']).read_bytes())
        for instance, package in packages.items():
            snapshot = out / 'packages' / (instance + '.json')
            snapshot.parent.mkdir(parents=True, exist_ok=True)
            snapshot.write_bytes(pinned_file(package['pin']).read_bytes())
        (out / 'plan.json').write_text(json.dumps(plan, indent=2)+'\n')
        (out / 'static-resolution.json').write_text(json.dumps(static, indent=2)+'\n')
        (out / 'state-layout.h').write_text(state_header(packages))
        generated = ['#include <stdint.h>', '#include "state-layout.h"', '/* Generated from immutable component graph. */']
        prototypes = set()
        provenance = []
        for n, (binding, hook, export) in enumerate(hooks):
            return_type = 'void' if export['return'] == 'void' else 'int32_t'
            sig = 'extern %s %s(%s);' % (return_type, export['symbol'], ','.join(TYPES[t] for t in export['args']) or 'void')
            if sig not in prototypes:
                prototypes.add(sig); generated.append(sig)
            args = ['(%s)(%s)' % (TYPES[t], argument(a, host, t, hook)) for a, t in zip(binding['args'], export['args'])]
            wrapper = 'gv_entry_%d' % n
            returned = '' if export['return'] == 'void' else 'return '
            signature=', '.join('%s r%d'%(TYPES[t],i) for i,t in enumerate(hook['args'])) or 'void' if hook['abi']=='aapcs-thumb' else 'uint32_t actor'
            generated.append('%s %s(%s) { %s%s(%s); }' % (return_type, wrapper, signature, returned, export['symbol'], ','.join(args)))
            provenance.append({'hook': hook, 'component': binding['instance'], 'export': binding['symbol'], 'generated_symbol': wrapper})
        # These leases describe existing host state; no unsafe unreserved RAM BSS.
        states = {i: p['native']['state_bindings'] for i, p in packages.items()}
        (out / 'state-layout.json').write_text(json.dumps(states, indent=2)+'\n')
        wrapper_path = out / 'bindings.c'
        wrapper_path.write_text('\n'.join(generated)+'\n')
        compile_flags = ['cc', '-target', 'armv4t-none-eabi', '-mcpu=arm7tdmi', '-mthumb', '-ffreestanding', '-fno-builtin', '-fno-common', '-Os', '-Wall', '-Wextra', '-Werror']
        objects = []
        for ref in sources:
            snapshot = out / 'sources' / ref
            snapshot.parent.mkdir(parents=True, exist_ok=True)
            snapshot.write_bytes(repository_file(ref).read_bytes())
        units = sorted({ref for p in packages.values() for ref in p['native']['translation_units']})
        for n, ref in enumerate(units):
            snapshot = out / 'sources' / ref
            obj = out / ('component-%d.o' % n)
            command('compile-%d' % n, compile_flags+['-c', str(snapshot), '-o', str(obj)], spec['timeout_s'])
            objects.append(str(obj))
        obj = out / 'bindings.o'
        command('compile-bindings', compile_flags+['-c', str(wrapper_path), '-o', str(obj)], spec['timeout_s'])
        objects.append(str(obj))
        linker = out / 'native.ld'
        linker.write_text('SECTIONS { . = 0x%x; .text : { *(.text*) *(.rodata*) } .forbidden : { *(.data*) *(.bss*) *(COMMON) } ASSERT(SIZEOF(.forbidden) == 0, "unreserved writable static state") /DISCARD/ : { *(.ARM.exidx*) *(.comment*) *(.note*) } }\n' % integer(host['append_address']))
        elf, binary = out/'components.elf', out/'components.bin'
        command('link', ['arm-none-eabi-ld', '-T', str(linker), '-Map='+str(out/'components.map'), '-e', 'gv_entry_0', *objects, '-o', str(elf)], spec['timeout_s'])
        command('emit', ['arm-none-eabi-objcopy', '-O', 'binary', str(elf), str(binary)], spec['timeout_s'])
        symbols = {}
        for line in command('symbols', ['arm-none-eabi-nm', '-n', str(elf)], spec['timeout_s']).splitlines():
            fields = line.split()
            if len(fields)==3:
                symbols[fields[2]] = int(fields[0], 16)
        payload = binary.read_bytes()
        if len(payload) > spec['max_payload_bytes'] or len(rom)+len(payload) > host['output_bytes']:
            raise ValueError('Native payload exceeds declared cartridge budget')
        assembled = bytearray(rom + payload)
        assembled.extend(b'\xff' * (host['output_bytes']-len(assembled)))
        for row in provenance:
            address = integer(row['hook']['address'])
            target = symbols[row['generated_symbol']] | 1
            if row['hook']['abi']=='aapcs-thumb' and len(row['hook']['args'])==4:
                # Thumb1 has no literal load into r12. Preserve the live fourth
                # AAPCS argument: push r3; ldr r3,[pc,#8]; mov r12,r3;
                # pop r3; bx r12; nop; aligned target. SP/LR and r0..r3 survive.
                veneer=bytes.fromhex('08b4024b9c4608bc6047c046')+target.to_bytes(4,'little')
            else:
                veneer = b'\x00\x4b\x18\x47' + target.to_bytes(4, 'little')
            offset = address-0x08000000
            assembled[offset:offset+len(veneer)] = veneer
            row.update(target=hex(target), output_bytes=veneer.hex())
        # Prove the full original cart remains byte-identical outside selected hooks.
        retained = bytearray(assembled[:len(rom)])
        for _, hook, _ in hooks:
            offset = integer(hook['address'])-0x08000000
            retained[offset:offset+len(bytes.fromhex(hook['preimage']))] = bytes.fromhex(hook['preimage'])
        if retained != rom:
            raise ValueError('Unexpected mutation outside graph-owned hooks')
        cart = out / 'game.gba'
        cart.write_bytes(assembled)
        lock = {'version': VERSION, 'plan_sha256': sha(canonical(plan)), 'host': spec['host'],
                'packages': {i: p['pin'] for i,p in packages.items()}, 'source_files': sources,
                'state_bindings': states, 'hook_lowering': provenance,
                'payload_address': host['append_address'], 'payload_bytes': len(payload),
                'payload_sha256': sha(payload), 'retained_foundation_sha256': sha(retained),
                'output_sha256': sha(assembled), 'output_bytes': len(assembled)}
        (out/'composition.lock.json').write_text(json.dumps(lock,indent=2)+'\n')
        receipt['artifacts'] = {str(path.relative_to(out)): {'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size} for path in [wrapper_path, linker, elf, binary, out/'state-layout.h', out/'state-layout.json', out/'components.map', out/'composition.lock.json']}
        receipt['stage_accounting'] = 'stage wall times are nested inside total wall_s; do not add them to total'
        receipt.update(outcome='built', lock_sha256=sha(canonical(lock)), output_sha256=sha(assembled), payload_bytes=len(payload), output=str(cart))
    except BaseException as exc:
        receipt.update(outcome='failed', error=str(exc))
        raise
    finally:
        receipt['wall_s'] = round(time.monotonic()-started, 6)
        save()
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    result = build(json.loads(args.plan.read_text()), args.rom, args.out)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
