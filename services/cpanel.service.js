const axios = require("axios");

exports.addDomain = async (domain) => {
  const response = await axios.post(
    `${process.env.CPANEL_HOST}/execute/DomainInfo/add_domain`,
    { domain }
  );

  return response.data;
};