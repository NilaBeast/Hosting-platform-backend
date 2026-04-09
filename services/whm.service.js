const axios = require("axios");
const https = require("https");
const whmConfig = require("../config/whm");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

/* ===============================
   CREATE WHM ACCOUNT
================================ */
exports.createAccount = async (data) => {
  try {
    const response = await axios.get(
      `${whmConfig.host}/json-api/createacct`,
      {
        httpsAgent,
        headers: {
          Authorization: `whm ${whmConfig.user}:${whmConfig.token}`,
        },
        params: {
          username: data.username,
          domain: data.domain,
          password: data.password,
          contactemail: data.email,
          pkgname: data.packageName || "default",
        },
      }
    );

    console.log("WHM CREATE RESPONSE:", response.data);

    const result = response.data.result?.[0];

    if (!result || result.status !== 1) {
      throw new Error(result?.statusmsg || "WHM account creation failed");
    }

    return response.data;
  } catch (error) {
    console.log(
      "WHM CREATE ERROR:",
      error.response?.data || error.message
    );
    throw error;
  }
};

/* ===============================
   CREATE CPANEL SESSION
================================ */
exports.createCpanelSession = async (username) => {
  try {
    const response = await axios.get(
      `${whmConfig.host}/json-api/create_user_session`,
      {
        httpsAgent,
        headers: {
          Authorization: `whm ${whmConfig.user}:${whmConfig.token}`,
        },
        params: {
          "api.version": 1,
          user: username,
          service: "cpaneld",
        },
      }
    );

    console.log("SESSION RESPONSE FULL:");
    console.log(JSON.stringify(response.data, null, 2));

    let loginUrl =
      response.data?.data?.cpaneld?.url ||
      response.data?.data?.url ||
      response.data?.cpaneld?.url;

    if (!loginUrl) {
      throw new Error("cPanel login URL not found in WHM response");
    }

    if (loginUrl.includes("217.217.249.67")) {
      loginUrl = loginUrl.replace(
        "https://217.217.249.67",
        "https://mypanel.hostzuno.co.in"
      );
    }

    return loginUrl;
  } catch (error) {
    console.log(
      "CPANEL SESSION ERROR:",
      error.response?.data || error.message
    );
    throw error;
  }
};