const encoder = new TextEncoder();
const schema = 'gameverse.agent-credential/1';
const encode = bytes => {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let offset = 0; offset < view.length; offset += 16384) {
    binary += String.fromCharCode(...view.subarray(offset, offset + 16384));
  }
  return btoa(binary);
};
const decode = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));

// The key is a Worker secret, never an R2 object or part of account metadata.
// This initial format deliberately supports one key; rotation needs a migration.
export class CredentialVault {
  constructor(keyHex) { this.keyHex = keyHex; }

  async key() {
    if (typeof this.keyHex !== 'string' || !/^[0-9a-f]{64}$/.test(this.keyHex)) {
      throw new Error('credential_key_not_configured');
    }
    const bytes = Uint8Array.from(this.keyHex.match(/../g), value => parseInt(value, 16));
    return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  context(scope) {
    // Bind ciphertext to its account, provider, login generation and revision.
    return encoder.encode(JSON.stringify([schema, scope.owner, scope.provider,
      scope.auth_method, scope.generation, scope.revision]));
  }

  async seal(credential, scope) {
    if (typeof credential !== 'string' || !credential.length || encoder.encode(credential).length > 65536) {
      throw new Error('invalid_credential');
    }
    const key = await this.key();
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce,
      additionalData: this.context(scope) }, key, encoder.encode(credential));
    return { schema, nonce: encode(nonce), ciphertext: encode(ciphertext) };
  }

  async open(envelope, scope) {
    const key = await this.key();
    try {
      if (envelope.schema !== schema) throw new Error();
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.nonce),
        additionalData: this.context(scope) }, key, decode(envelope.ciphertext));
      return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    } catch { throw new Error('credential_unavailable'); }
  }
}
