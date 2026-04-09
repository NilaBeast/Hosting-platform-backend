exports.generateUsername = (domain) => {
  return domain.split(".")[0];
};