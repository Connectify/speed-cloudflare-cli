const { performance } = require("node:perf_hooks");
const https = require("node:https");
const { magenta, bold, yellow, green, blue } = require("./chalk");
const stats = require("./stats");

let flushing = true;

/**
 * @typedef {Object} Results
 * @property {string} server_location - Location string.
 * @property {string} your_ip - IP address and location string.
 * @property {{min: string, max: string, average: string, median: string, jitter: string}} latency - Latency metrics.
 * @property {number[]} download_speeds - List of download speeds.
 * @property {Array<{size: string, speed: string}>} download_speeds - List of download speeds.
 * @property {Array<{size: string, speed: string}>} upload_speeds - List of upload speeds.
 */

/** @type {Results} */
let results;
const iterations = {
  "100kB": 10,
  "1MB": 8,
  "10MB": 6,
  "25MB": 4,
  "100MB": 1,
};

async function get(hostname, path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: "GET",
      },
      (res) => {
        const body = [];
        res.on("data", (chunk) => {
          body.push(chunk);
        });
        res.on("end", () => {
          try {
            resolve(Buffer.concat(body).toString());
          } catch (e) {
            reject(e);
          }
        });
        req.on("error", (err) => {
          reject(err);
        });
      },
    );

    req.end();
  });
}

async function fetchServerLocationData() {
  const res = JSON.parse(await get("speed.cloudflare.com", "/locations"));

  return res.reduce((data, { iata, city }) => {
    // Bypass prettier "no-assign-param" rules
    const data1 = data;

    data1[iata] = city;
    return data1;
  }, {});
}

async function fetchCfCdnCgiTrace() {
  const parseCfCdnCgiTrace = (text) =>
    text
      .split("\n")
      .map((i) => {
        const j = i.split("=");

        return [j[0], j[1]];
      })
      .reduce((data, [k, v]) => {
        if (v === undefined) return data;

        // Bypass prettier
        // "no-assign-param" rules
        const data1 = data;
        // Object.fromEntries is only
        // supported by Node.js 12 or newer
        data1[k] = v;

        return data1;
      }, {});

  return get("speed.cloudflare.com", "/cdn-cgi/trace").then(parseCfCdnCgiTrace);
}

function request(optionsParam, data = "") {
  let started;
  let dnsLookup;
  let tcpHandshake;
  let sslHandshake;
  let ttfb;
  let ended;
  const options = optionsParam;

  options.agent = new https.Agent(optionsParam);

  return new Promise((resolve, reject) => {
    started = performance.now();
    const req = https.request(options, (res) => {
      res.once("readable", () => {
        ttfb = performance.now();
      });
      res.on("data", () => {});
      res.on("end", () => {
        ended = performance.now();
        resolve({ started, dnsLookup, tcpHandshake, sslHandshake, ttfb, ended, serverTiming: parseFloat(res.headers["server-timing"].slice(22)) });
      });
    });

    req.on("socket", (socket) => {
      socket.on("lookup", () => {
        dnsLookup = performance.now();
      });
      socket.on("connect", () => {
        tcpHandshake = performance.now();
      });
      socket.on("secureConnect", () => {
        sslHandshake = performance.now();
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

function download(bytes) {
  const options = {
    hostname: "speed.cloudflare.com",
    path: `/__down?bytes=${bytes}`,
    method: "GET",
  };

  return request(options);
}

function upload(bytes) {
  const data = "0".repeat(bytes);
  const options = {
    hostname: "speed.cloudflare.com",
    path: "/__up",
    method: "POST",
    headers: {
      "Content-Length": Buffer.byteLength(data),
    },
  };

  return request(options, data);
}

function measureSpeed(bytes, duration) {
  return (bytes * 8) / (duration / 1000) / 1e6;
}

async function handlePromises(count, operation, responseHandler) {
  const promises = [];

  for (let i = 0; i < count; i += 1) {
    promises.push(operation().then(responseHandler, (error) => console.error(`Error: ${error}`)));
  }

  await Promise.all(promises);
}

async function measureLatency() {
  const measurements = [];

  await handlePromises(
    20,
    () => download(1000),
    (response) => {
      // TTFB - Server processing time
      measurements.push(response.ttfb - response.started - response.serverTiming);
    },
  );

  return [Math.min(...measurements), Math.max(...measurements), stats.average(measurements), stats.median(measurements), stats.jitter(measurements)];
}

async function measureDownload(bytes, count) {
  const measurements = [];

  await handlePromises(
    count,
    () => download(bytes),
    (response) => {
      const transferTime = response.ended - response.ttfb;
      measurements.push(measureSpeed(bytes, transferTime));
    },
  );

  return measurements;
}

async function measureUpload(bytes, count) {
  const measurements = [];

  await handlePromises(
    count,
    () => upload(bytes),
    (response) => {
      const transferTime = response.serverTiming;
      measurements.push(measureSpeed(bytes, transferTime));
    },
  );

  return measurements;
}

function logInfo(text, data) {
  if (flushing) {
    console.log(bold(" ".repeat(15 - text.length), `${text}:`, blue(data)));
  }
}

function logLatency(data) {
  if (flushing) {
    console.log(bold("         Latency:", magenta(`${data.median} ms`)));
    console.log(bold("          Jitter:", magenta(`${data.jitter} ms`)));
  }
}

function logSpeedTestResult(displaySize, test, direction = "↑", speedStore = [], show = true) {
  const displaySpeed = stats.median(test).toFixed(2);

  if (flushing && show) {
    console.log(bold(" ".repeat(7 - displaySize.length), direction, displaySize, "speed:", yellow(`${displaySpeed} Mbps`)));
    return test;
  }

  speedStore.push({ size: displaySize, speed: displaySpeed });
  return test;
}

function logDownloadSpeed(tests) {
  const displaySpeed = stats.quartile(tests, 0.9).toFixed(2);
  if (flushing) {
    console.log(bold("  Download speed:", green(displaySpeed, "Mbps")));
    return;
  }
  results.download_speeds.push({ size: "overall", speed: displaySpeed });
}

function logUploadSpeed(tests) {
  const displaySpeed = stats.quartile(tests, 0.9).toFixed(2);
  if (flushing) {
    console.log(bold("    Upload speed:", green(displaySpeed, "Mbps")));
    return;
  }
  results.upload_speeds.push({ size: "overall", speed: displaySpeed });
}

// Function to parse command-line arguments
function basename(p) {
  if (!p) return "";
  return (
    p
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || p
  );
}

function isRuntimeExecutable(execBase) {
  const b = execBase.toLowerCase();
  return b === "node" || b === "node.exe" || b === "deno" || b === "deno.exe";
}

function displayExec(execPath) {
  const base = basename(execPath);
  const hasSep = /[\\/]/.test(execPath);
  return hasSep ? `./${base}` : base;
}

function buildInvocation(argv, { includeArgs = true } = {}) {
  const [execPath = "", scriptPath = "", ...args] = Array.isArray(argv) ? argv : [];
  const execBase = basename(execPath);

  const parts = [];
  if (isRuntimeExecutable(execBase)) {
    // When launched via node/deno, show "node script.js" if a script is present
    const script = scriptPath && !scriptPath.startsWith("-") ? basename(scriptPath) : "";
    parts.push(execBase, ...(script ? [script] : []));
  } else {
    // Compiled binary: show just the binary name
    parts.push(displayExec(execPath));
  }

  if (includeArgs) parts.push(...args);
  return parts.join(" ").trim();
}

// Function to parse command-line arguments
function parseArgs() {
  const args = {};

  process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith("--")) {
      /* eslint prefer-const: "off" */
      let [key, value] = arg.split("=");

      // Convert --with-space to camelCase
      key = key.replace(/--([a-z0-9_-]+)/g, (_, rest) =>
        rest.split('-').map((part, index) => {
          if (index===0) return part.toLowerCase();
          return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        }).join(''));

      args[key] = value || true;
    }
  });

  const baseInvocation = buildInvocation(process.argv, { includeArgs: false });

  return { args, baseInvocation };
}

function convertToBytes(size) {
  const [value, unit] = size.match(/^(\d+)([a-zA-Z]+)$/).slice(1);
  const multiplier = { kB: 1024, MB: 1024 * 1024 }[unit];
  return value * multiplier;
}

function displayHelp(originalInvocation) {
  console.log(`
Usage: ${originalInvocation}

Options
  --help        Show this help message and exit.
  --json        Output results in JSON format.
  --speed-mode  Specify the speed mode. Options are 'slow', 'medium', or 'fast'.
  --summary     Provide a summary of results.
  --show-up     Display additional output information.

Examples:
  ${originalInvocation} --help
  ${originalInvocation} --json --speed-mode=fast
  ${originalInvocation} --summary --show-up

For more information, refer to the documentation.
`);
}

function getResult(city, ip, loc, colo, ping) {
  return {
    server_location: `${city} (${colo})`,
    your_ip: `${ip} (${loc})`,
    latency: {
      min: ping[0].toFixed(2),
      max: ping[1].toFixed(2),
      average: ping[2].toFixed(2),
      median: ping[3].toFixed(2),
      jitter: ping[4].toFixed(2),
    },
    download_speeds: [],
    upload_speeds: [],
  };
}

async function runDownloadTests(speedsToTest, show) {
  const testPromises = speedsToTest.map(async (size) => {
    const measured = await measureDownload(convertToBytes(size), iterations[size]);
    return logSpeedTestResult(size, measured, "↓", results.download_speeds, show);
  });

  // Wait for all promises to resolve
  const downloadTestsResults = await Promise.all(testPromises);

  logDownloadSpeed([].concat(...downloadTestsResults));
}

async function runUploadTests(speedsToTest, show) {
  const testPromises = speedsToTest.map(async (size) => {
    const measured = await measureUpload(convertToBytes(size), iterations[size]);
    return logSpeedTestResult(size, measured, "↑", results.upload_speeds, show);
  });

  const uploadTestsResults = await Promise.all(testPromises);

  logUploadSpeed([].concat(...uploadTestsResults));
}

async function speedTest() {
  const { args, baseInvocation } = parseArgs();
  const [ping, serverLocationData, { ip, loc, colo }] = await Promise.all([measureLatency(), fetchServerLocationData(), fetchCfCdnCgiTrace()]);
  const city = serverLocationData[colo];
  const noSummary = !("summary" in args);
  const showUp = "showUp" in args;
  let speedsToTest = Object.keys(iterations);

  if ("help" in args) {
    displayHelp(baseInvocation);
    return;
  }

  if ("only" in args && !(args.only in iterations)) {
    console.log(`Invalid speed given: ${args.only}`);
    displayHelp(baseInvocation);
    return;
  }

  if ("only" in args) {
    speedsToTest = [args.only];
  }

  flushing = !args.json;
  results = getResult(city, ip, loc, colo, ping);
  logInfo("Server Location", results.server_location);
  logInfo("Your IP", results.your_ip);
  logLatency(results.latency);

  await runDownloadTests(speedsToTest, noSummary);
  await runUploadTests(speedsToTest, noSummary && showUp);

  // Conditional output based on --json option
  if (!flushing) {
    console.log(JSON.stringify(results, null, 2));
  }
}

module.exports = {
  get,
  fetchServerLocationData,
  fetchCfCdnCgiTrace,
  request,
  download,
  upload,
  measureSpeed,
  measureLatency,
  measureDownload,
  measureUpload,
  logInfo,
  logLatency,
  logSpeedTestResult,
  logDownloadSpeed,
  logUploadSpeed,
  parseArgs,
  speedTest,
};
