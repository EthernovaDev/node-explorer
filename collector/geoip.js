const fs = require('node:fs');
const maxmind = require('maxmind');

async function createGeoIp(countryPath, asnPath) {
  let countryReader = null;
  let asnReader = null;

  if (countryPath && fs.existsSync(countryPath)) {
    countryReader = await maxmind.open(countryPath);
  }

  if (asnPath && fs.existsSync(asnPath)) {
    asnReader = await maxmind.open(asnPath);
  }

  function lookup(ip) {
    const result = {
      countryCode: null,
      countryName: null,
      asnNumber: null,
      asnOrg: null
    };

    if (!ip) {
      return result;
    }

    if (countryReader) {
      try {
        const data = countryReader.get(ip);
        if (data && data.country) {
          result.countryCode = data.country.iso_code || null;
          result.countryName = (data.country.names && data.country.names.en) || null;
        }
      } catch (err) {
        // Ignore lookup errors
      }
    }

    if (asnReader) {
      try {
        const data = asnReader.get(ip);
        if (data) {
          result.asnNumber = data.autonomous_system_number || null;
          result.asnOrg = data.autonomous_system_organization || null;
        }
      } catch (err) {
        // Ignore lookup errors
      }
    }

    return result;
  }

  return {
    lookup,
    hasCountry: Boolean(countryReader),
    hasAsn: Boolean(asnReader)
  };
}

module.exports = {
  createGeoIp
};


