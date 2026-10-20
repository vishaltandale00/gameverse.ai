import test from 'node:test';
import assert from 'node:assert/strict';
import { getCountries,parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { defaultPhoneCountry,normalizePhoneInput } from '../../src/phone-input.js';

test('local numbers, country trunk prefixes and explicit international numbers normalize for SMS',()=>{
  for(const [input,country,expected,resolved] of [
    ['2015550123','US','+12015550123','US'],
    ['(201) 555-0123','US','+12015550123','US'],
    ['1 201 555 0123','US','+12015550123','US'],
    ['98765 43210','IN','+919876543210','IN'],
    ['020 7946 0018','GB','+442079460018','GB'],
    ['+44 20 7946 0018','US','+442079460018','GB'],
  ])assert.deepEqual(normalizePhoneInput(input,country,parsePhoneNumberFromString),{number:expected,country:resolved});
  for(const input of ['123','Call 2015550123','2015550123 ext. 5'])assert.throws(()=>normalizePhoneInput(input,'US',parsePhoneNumberFromString),/selected country/);
});

test('country suggestions prefer network country then an explicit browser region, with a US fallback',()=>{
  const countries=getCountries();
  assert.equal(defaultPhoneCountry(countries,'IN',['en-US']),'IN');
  assert.equal(defaultPhoneCountry(countries,'XX',['en','en-GB']),'GB');
  assert.equal(defaultPhoneCountry(countries,null,['invalid locale','en']),'US');
});
