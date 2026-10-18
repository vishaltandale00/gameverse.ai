// Keep number parsing separate from the page so browser and format checks share it.
export function defaultPhoneCountry(countries, locationCountry, locales = []) {
  if (countries.includes(locationCountry)) return locationCountry;
  for (const locale of locales) {
    try {
      const region = new Intl.Locale(locale).region;
      if (countries.includes(region)) return region;
    } catch { /* An unsupported browser locale is only a missing hint. */ }
  }
  return 'US';
}

export function normalizePhoneInput(value, country, parser) {
  const phone = parser(value.trim(), { defaultCountry: country, extract: false });
  if (!phone || !phone.isValid() || phone.ext) {
    throw Error('Check your phone number and selected country, then try again.');
  }
  return { number: phone.number, country: phone.country || country };
}
