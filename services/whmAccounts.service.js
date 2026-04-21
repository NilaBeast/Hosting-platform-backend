const axios = require("axios");

const WHM_URL = process.env.WHM_HOST;
const WHM_USERNAME = process.env.WHM_USER;
const WHM_TOKEN = process.env.WHM_TOKEN;

exports.getWHMAccounts = async () => {
  try {
    const res = await axios.get(
      `${WHM_URL}/json-api/listaccts?api.version=1`,
      {
        headers: {
          Authorization: `whm ${WHM_USERNAME}:${WHM_TOKEN}`,
        },
      }
    );

    return res.data?.data?.acct || [];
  } catch (err) {
    console.log(err.response?.data || err.message);
    throw new Error("Failed to fetch WHM accounts");
  }
};