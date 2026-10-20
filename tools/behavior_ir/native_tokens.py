"""Finite adapter-only code-token codec for source continuation spill effects.

Tokens are portable storage values, not callable host addresses. Unknown values
fail the oracle; ordinary fields keep their existing byte interpretation.
"""


def render(adapter, rom):
    codecs = adapter.get('continuation_tokens', [])
    if not codecs:
        return '', []
    if not adapter.get('native_abi') or len(codecs) > 16:
        raise ValueError('continuation tokens require bounded explicit native ABI')
    fields = {field['name']: (index, field)
              for index, field in enumerate(adapter['fields'])}
    seen = set()
    encoded = []
    decoded = []
    for codec in codecs:
        name = codec['field']
        if name in seen or name not in fields:
            raise ValueError('duplicate or unknown continuation token field')
        seen.add(name)
        index, field = fields[name]
        if field['owner'] != 'global' or field['width'] != 32:
            raise ValueError('continuation tokens require global u32 spill field')
        if codec.get('initial_token') != 0 or field.get('domain') != {
                'unsigned_min': 0, 'unsigned_max': 0}:
            raise ValueError('continuation token entry must be explicit null domain')
        evidence = codec.get('source_evidence', {})
        if not evidence.get('raw_source_sha256s') or not evidence.get('store_provenance'):
            raise ValueError('continuation token requires source normalization evidence')
        tokens = codec['tokens']
        if not 1 <= len(tokens) <= 32:
            raise ValueError('continuation token table budget')
        mapping = {0: 0}
        native_values = {0}
        for row in tokens:
            token, native = row['token'], row['native_value']
            if not isinstance(token, int) or not 1 <= token <= 0xffffffff or token in mapping:
                raise ValueError('invalid portable continuation token')
            if not isinstance(native, int) or not native & 1 or native in native_values:
                raise ValueError('continuation target must be unique Thumb code')
            if not 0 <= (native & ~1) - 0x08000000 <= len(rom) - 2:
                raise ValueError('continuation target outside original ROM')
            mapping[token] = native
            native_values.add(native)
        encoded.append('case ' + str(index) + ':switch(value){' + ''.join(
            'case ' + str(token) + 'u:*out=' + str(native) + 'u;return 1;'
            for token, native in mapping.items()) + 'default:return 0;}')
        decoded.append('case ' + str(index) + ':switch(value){' + ''.join(
            'case ' + str(native) + 'u:*out=' + str(token) + 'u;return 1;'
            for token, native in mapping.items()) + 'default:return 0;}')
    helpers = ('static int continuation_encode(unsigned field,uint32_t value,uint32_t*out){switch(field){'
               + ''.join(encoded) + 'default:*out=value;return 1;}}\n'
               + 'static int continuation_decode(unsigned field,uint32_t value,uint32_t*out){switch(field){'
               + ''.join(decoded) + 'default:*out=value;return 1;}}\n')
    return helpers, codecs
