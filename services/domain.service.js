const axios = require("axios");
const https = require("https");
const whmConfig = require("../config/whm");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

exports.createAddonDomain = async (cpanelUser, domain) => {
  try {
    const response = await axios.get(
      `${whmConfig.host}/json-api/cpanel`,
      {
        httpsAgent,
        headers: {
          Authorization: `whm ${whmConfig.user}:${whmConfig.token}`,
        },
        params: {
          "api.version": 1,
          cpanel_jsonapi_user: cpanelUser,
          cpanel_jsonapi_apiversion: 2,
          cpanel_jsonapi_module: "AddonDomain",
          cpanel_jsonapi_func: "addaddondomain",
          newdomain: domain,
          subdomain: domain.replace(/\./g, ""),
          dir: `public_html/${domain}`,
        },
      }
    );

    console.log("ADDON DOMAIN RESPONSE:", response.data);

    return response.data;
  } catch (err) {
    console.log("ADDON DOMAIN ERROR:", err.response?.data || err.message);
    throw err;
  }
};