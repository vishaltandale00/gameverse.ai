import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
export const stagingSecretsPath = new URL('local-data/hosting/staging-secrets.json', root);

export async function prepareStagingSecrets() {
  const local = parseEnv(await readFile(new URL('.env', root), 'utf8'));
  if (!local.DAYTONA_API_KEY?.trim()) throw Error('Set DAYTONA_API_KEY in the ignored root .env first.');
  let existing = {};
  try { existing = JSON.parse(await readFile(stagingSecretsPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const secrets = {
    STAGING_API_TOKEN: existing.STAGING_API_TOKEN || randomBytes(32).toString('base64url'),
    DAYTONA_API_KEY: local.DAYTONA_API_KEY.trim(),
    ACCOUNT_ID_KEY: existing.ACCOUNT_ID_KEY || randomBytes(32).toString('hex'),
    AGENT_CREDENTIAL_KEY: existing.AGENT_CREDENTIAL_KEY || randomBytes(32).toString('hex'),
  };
  for(const name of ['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_VERIFY_SERVICE_SID',
    'GAMEVERSE_PILOT_PHONES','GAMEVERSE_DEVELOPER_PHONES']) {
    const value=local[name]?.trim()||existing[name];
    if(value)secrets[name]=value;
  }
  if (typeof secrets.STAGING_API_TOKEN !== 'string' || secrets.STAGING_API_TOKEN.length < 32) throw Error('Invalid retained staging token.');
  await mkdir(new URL('local-data/hosting/', root), { recursive: true, mode: 0o700 });
  await writeFile(stagingSecretsPath, `${JSON.stringify(secrets)}\n`, { mode: 0o600 });
  await chmod(stagingSecretsPath, 0o600);
  return { file: fileURLToPath(stagingSecretsPath), names: Object.keys(secrets) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepareStagingSecrets())); }
  catch (error) {
    // Parsing/OS errors can contain fragments of a credential file. Never print them.
    console.error(error.code === 'ENOENT'
      ? 'Missing local .env file.'
      : 'Unable to prepare staging secrets. Check local configuration and permissions without printing credential files.');
    process.exitCode = 1;
  }
}
