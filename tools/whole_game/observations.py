"""Pinned read-only source facts; no inputs, routes, or writes live here."""
import hashlib
import json
from pathlib import Path
import struct

from .elf_symbols import symbol
from .pipeline import check_pin


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class SourceObserver:
    schema = 'gba-source-readonly/1'

    def __init__(self, path, manifest):
        self.path = Path(path).resolve()
        self.sha256 = sha(self.path)
        self.implementation_files = {name:sha(Path(__file__).with_name(name)) for name in ('observations.py','party_decode.py','elf_symbols.py')}
        self.implementation_sha256 = hashlib.sha256(json.dumps(self.implementation_files,sort_keys=True).encode()).hexdigest()
        self.profile = json.loads(self.path.read_text())
        if self.profile.get('schemaVersion') != 1 or self.profile.get('purpose') != 'read_only_source_observation':
            raise ValueError('unsupported_source_observation_profile')
        self.regions = self.profile['regions']
        self.functions = {}
        for source in manifest['sources']:
            region = source['id']
            profile = self.regions[region]
            if profile['romSha256'] != source['rom']['sha256'] or profile['elfSha256'] != source['elf']['sha256']:
                raise ValueError('observation_profile_source_mismatch')
            elf = check_pin(source['elf'])
            for name, address in profile['symbols'].items():
                if symbol(elf, name)[0] != int(address, 0):
                    raise ValueError('observation_profile_symbol_mismatch')
            index = profile['functionSymbols']
            if sha(index['path']) != index['sha256']:
                raise ValueError('observation_function_index_mismatch')
            data = json.loads(Path(index['path']).read_text())
            if data['elfSha256'] != profile['elfSha256']:
                raise ValueError('observation_function_elf_mismatch')
            self.functions[region] = data['functions']

    def enrich(self, session, observation):
        region, engine = session.active, session.engine
        profile, layouts = self.regions[region], self.profile['layouts']
        addresses = {name: int(value, 0) for name, value in profile['symbols'].items()}
        def read(address, count):
            return b''.join(engine.read_memory(address + offset, min(256, count-offset)) for offset in range(0,count,256))
        def names(pointer):
            return [name for name in self.functions[region].get('0x%08x' % (pointer & ~1), []) if not name.startswith('.')]
        main = read(addresses['gMain'], 48)
        callback = int.from_bytes(main[4:8], 'little')
        tasks, printers = [], []
        layout = layouts['tasks']
        raw = read(addresses[layout['symbol']], layout['count'] * layout['stride'])
        for slot in range(layout['count']):
            task = raw[slot*layout['stride']:(slot+1)*layout['stride']]
            if task[layout['isActive']]:
                pointer = int.from_bytes(task[:4], 'little')
                tasks.append({'slot':slot,'functions':names(pointer),'priority':task[layout['priority']]})
        layout = layouts['textPrinters']
        raw = read(addresses[layout['symbol']], layout['count'] * layout['stride'])
        states = {number:name for name, number in layout['stateValues'].items()}
        for slot in range(layout['count']):
            printer = raw[slot*layout['stride']:(slot+1)*layout['stride']]
            if printer[layout['active']]:
                printers.append({'window':slot,'state':states.get(printer[layout['state']], 'unknown'),
                                 'character_pointer':int.from_bytes(printer[:4], 'little')})
        avatar = read(addresses['gPlayerAvatar'], 8)
        objects = layouts['objectEvents']
        slot = avatar[layouts['playerAvatar']['objectEventId']]
        player = None
        if slot < objects['count']:
            obj = read(addresses[objects['symbol']] + slot * objects['stride'], objects['stride'])
            active, is_player = objects['activeBit'], objects['isPlayerBit']
            if obj[active['byte']] & active['mask'] and obj[is_player['byte']] & is_player['mask']:
                player = {'x':struct.unpack_from('<h',obj,objects['currentX'])[0],
                          'y':struct.unpack_from('<h',obj,objects['currentY'])[0],
                          'previous_x':struct.unpack_from('<h',obj,objects['previousX'])[0],
                          'previous_y':struct.unpack_from('<h',obj,objects['previousY'])[0],
                          'map_group':obj[objects['mapGroup']], 'map_num':obj[objects['mapNum']],
                          'facing':obj[objects['facingDirection']['byte']] & objects['facingDirection']['mask'],
                          'tile_transition_state':avatar[layouts['playerAvatar']['tileTransitionState']]}
        callback_names = names(callback)
        if not any(name in ('CB2_Overworld', 'CB2_OverworldBasic') for name in callback_names):
            player = None
        facts = observation.setdefault('facts', {})
        party_count = read(addresses['gPlayerPartyCount'],1)[0]
        if party_count > 6:
            raise ValueError('invalid_native_party_count')
        facts.update(source_callback2=callback, source_callback2_name=callback_names[0] if callback_names else None, native_party_count=party_count,
                     source_observation_schema=self.schema, source_observation_profile_sha256=self.sha256,
                     source_callback2_names=names(callback), native_tasks=tasks, native_text_printers=printers,
                     field_controls_locked=bool(read(addresses['sLockFieldControls'],1)[0]),
                     script_context_status=read(addresses['sGlobalScriptContextStatus'],1)[0],
                     in_battle=bool(read(addresses['gMain']+layouts['main']['inBattleBit']['byte'],1)[0] & layouts['main']['inBattleBit']['mask']),
                     live_player=player,
                     text_readiness_basis='Printer state and native task functions are observations; neither alone proves all inputs are ready.')
        # Native source handles character emission autonomously in these states.
        # Waiting is reversible; input-requiring printer states stop continuation.
        printing = bool(printers) and all(p['state'] in ('handleChar','scroll','waitSe','pause') for p in printers)
        task_names = [name for task in tasks for name in task['functions']]
        facts['source_text_printing'] = printing
        facts['source_text_awaiting_input'] = any(p['state'] in ('wait','clear','scrollStart') for p in printers)
        facts['noninteractive_wait_safe'] = printing or any(name in (
            'CB2_InitCopyrightScreenAfterBootup','CB2_InitCopyrightScreenAfterTitleScreen',
            'MainCB2_EndIntro','CB2_InitTitleScreen','CB2_GoToMainMenu') for name in callback_names)
        progress = observation.setdefault('progress', {})
        progress.update(source_callback2=callback, native_party_count=party_count, native_tasks=task_names, text_printers=printers)
        from .party_decode import SCHEMA as PARTY_SCHEMA, decode
        if layouts['party'].get('decoder') == PARTY_SCHEMA:
            party = [dict(decode(read(addresses['gPlayerParty']+slot*100,100)),slot=slot) for slot in range(party_count)]
            facts['native_party'] = party
            progress['native_party'] = party
        else:
            facts['native_party_decode'] = 'unavailable: source profile has not opted into verified party parser'
        if player is not None:
            progress['live_player'] = player
        observation.setdefault('evidence', {})['source_observation'] = {'schema':self.schema,'profile_sha256':self.sha256}
        return observation
