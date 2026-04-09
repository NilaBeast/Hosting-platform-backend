const ftp = require("basic-ftp");
const fs = require("fs");
const path = require("path");

async function uploadDirectory(client, localDir, remoteDir, logs) {
  const files = fs.readdirSync(localDir);

  for (const file of files) {
    const localPath = path.join(localDir, file);
    const remotePath = `${remoteDir}/${file}`;

    if (fs.lstatSync(localPath).isDirectory()) {
      await client.ensureDir(remotePath);
      await uploadDirectory(client, localPath, remotePath, logs);
    } else {
      await client.uploadFrom(localPath, remotePath);
      logs.push(`Uploaded: ${file}`);
    }
  }
}

exports.uploadToCpanel = async (username, domain, localFolder) => {
  const client = new ftp.Client();
  const logs = [];

  try {
    logs.push("Connecting to FTP...");

    await client.access({
      host: process.env.CPANEL_FTP_HOST,
      user: username,
      password: process.env.WHM_DEFAULT_PASSWORD, // or user password
      secure: false,
    });

    logs.push("Connected to FTP");

    const remoteDir = "/public_html";

    await uploadDirectory(client, localFolder, remoteDir, logs);

    logs.push("Upload completed");

    return logs;
  } catch (err) {
    console.log(err);
    throw err;
  } finally {
    client.close();
  }
};