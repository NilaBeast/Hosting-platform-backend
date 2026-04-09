const simpleGit = require("simple-git");
const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");

let currentPort = 4000;
const runningApps = {};

function fixIndexPaths(indexFile) {
  if (!fs.existsSync(indexFile)) return;

  let html = fs.readFileSync(indexFile, "utf8");

  html = html
    .replace(/href="\/assets\//g, 'href="./assets/')
    .replace(/src="\/assets\//g, 'src="./assets/')
    .replace(/href="\/static\//g, 'href="./static/')
    .replace(/src="\/static\//g, 'src="./static/')
    .replace(/href="\/images\//g, 'href="./images/')
    .replace(/src="\/images\//g, 'src="./images/');

  fs.writeFileSync(indexFile, html);
}

exports.deployRepo = async (repoUrl) => {
  const logs = [];

  const tempDir = path.join(__dirname, "../../temp");
  const sitesDir = path.join(__dirname, "../../sites");
  const appsDir = path.join(__dirname, "../../apps");

  if (!fs.existsSync(sitesDir)) fs.mkdirSync(sitesDir);
  if (!fs.existsSync(appsDir)) fs.mkdirSync(appsDir);

  logs.push("🚀 Starting deployment...");

  // Clean temp
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // Clone repo
  const git = simpleGit();
  await git.clone(repoUrl, tempDir);
  logs.push("Repository cloned");

  const packageJsonPath = path.join(tempDir, "package.json");

  // ===============================
  // NODE PROJECT
  // ===============================
  if (fs.existsSync(packageJsonPath)) {
    logs.push("Node project detected");

    await new Promise((resolve, reject) => {
      exec(`cd ${tempDir} && npm install`, (err) => {
        if (err) return reject(err);
        logs.push("Dependencies installed");
        resolve();
      });
    });

    const appFile =
      fs.existsSync(path.join(tempDir, "app.js"))
        ? "app.js"
        : fs.existsSync(path.join(tempDir, "server.js"))
        ? "server.js"
        : null;

    if (appFile) {
      const appName = "app_" + Date.now();
      const appPath = path.join(appsDir, appName);

      fs.mkdirSync(appPath);
      fs.cpSync(tempDir, appPath, { recursive: true });

      const port = currentPort++;

      const child = spawn("node", [appFile], {
        cwd: appPath,
        env: { ...process.env, PORT: port },
        stdio: "inherit",
      });

      runningApps[appName] = port;

      logs.push("Node app started on port " + port);

      const url = `http://localhost:${process.env.PORT}/sites/${appName}`;
      logs.push("Live URL: " + url);

      return {
        logs,
        url,
        path: appPath,
        type: "node",
        appName,
        port,
      };
    }

    // Otherwise build static
    logs.push("Building project...");

    await new Promise((resolve, reject) => {
      exec(`cd ${tempDir} && npm run build`, (err) => {
        if (err) return reject(err);
        logs.push("Build completed");
        resolve();
      });
    });
  }

  // ===============================
  // STATIC SITE
  // ===============================
  let uploadDir = tempDir;

  if (fs.existsSync(path.join(tempDir, "dist"))) {
    uploadDir = path.join(tempDir, "dist");
    logs.push("Using dist folder");
  }

  if (fs.existsSync(path.join(tempDir, "build"))) {
    uploadDir = path.join(tempDir, "build");
    logs.push("Using build folder");
  }

  const siteName = "site_" + Date.now();
  const sitePath = path.join(sitesDir, siteName);

  fs.mkdirSync(sitePath);
  fs.cpSync(uploadDir, sitePath, { recursive: true });

  logs.push("Static site deployed");

  fixIndexPaths(path.join(sitePath, "index.html"));

  const url = `http://localhost:${process.env.PORT}/sites/${siteName}`;
  logs.push("Live URL: " + url);

  return {
    logs,
    url,
    path: sitePath,
    type: "static",
  };
};