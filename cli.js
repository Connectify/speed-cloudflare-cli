#!/usr/bin/env node

const { performance } = require("perf_hooks");
const https = require("https");
const { magenta, bold, yellow, green, blue } = require("./chalk.js");
const stats = require("./stats.js");

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

function fetchCfCdnCgiTrace() {
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

function request(options, data = "") {
  let started;
  let dnsLookup;
  let tcpHandshake;
  let sslHandshake;
  let ttfb;
  let ended;

  options.agent = new https.Agent(options);

  return new Promise((resolve, reject) => {
    started = performance.now();
    const req = https.request(options, (res) => {
      res.once("readable", () => {
        ttfb = performance.now();
      });
      res.on("data", () => {});
      res.on("end", () => {
        ended = performance.now();
        resolve([started, dnsLookup, tcpHandshake, sslHandshake, ttfb, ended, parseFloat(res.headers["server-timing"].slice(22))]);
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

async function measureLatency() {
  const measurements = [];

  for (let i = 0; i < 20; i += 1) {
    await download(1000).then(
      (response) => {
        // TTFB - Server processing time
        measurements.push(response[4] - response[0] - response[6]);
      },
      (error) => {
        console.log(`Error: ${error}`);
      },
    );
  }

  return [Math.min(...measurements), Math.max(...measurements), stats.average(measurements), stats.median(measurements), stats.jitter(measurements)];
}

async function measureDownload(bytes, iterations) {
  const measurements = [];

  for (let i = 0; i < iterations; i += 1) {
    await download(bytes).then(
      (response) => {
        const transferTime = response[5] - response[4];
        measurements.push(measureSpeed(bytes, transferTime));
      },
      (error) => {
        console.log(`Error: ${error}`);
      },
    );
  }

  return measurements;
}

async function measureUpload(bytes, iterations) {
  const measurements = [];

  for (let i = 0; i < iterations; i += 1) {
    await upload(bytes).then(
      (response) => {
        const transferTime = response[6];
        measurements.push(measureSpeed(bytes, transferTime));
      },
      (error) => {
        console.log(`Error: ${error}`);
      },
    );
  }

  return measurements;
}

function logInfo(text, data) {
  console.log(bold(" ".repeat(15 - text.length), `${text}:`, blue(data)));
}

function logLatency(data) {
  console.log(bold("         Latency:", magenta(`${data[3].toFixed(2)} ms`)));
  console.log(bold("          Jitter:", magenta(`${data[4].toFixed(2)} ms`)));
}

function logSpeedTestResult(size, test) {
  const speed = stats.median(test).toFixed(2);
  console.log(bold(" ".repeat(9 - size.length), size, "speed:", yellow(`${speed} Mbps`)));
}

function logDownloadSpeed(tests) {
  console.log(bold("  Download speed:", green(stats.quartile(tests, 0.9).toFixed(2), "Mbps")));
}

function logUploadSpeed(tests) {
  console.log(bold("    Upload speed:", green(stats.quartile(tests, 0.9).toFixed(2), "Mbps")));
}

const { performance } = require("perf_hooks");
const https = require("https");
const { magenta, bold, yellow, green, blue } = require("./chalk.js");
const stats = require("./stats.js");

// Function to parse command-line arguments
function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith("--")) {
      args[arg.slice(2)] = true;
    }
  });
  return args;
}

async function speedTest() {
  const args = parseArgs();
  const [ping, serverLocationData, { ip, loc, colo }] = await Promise.all([measureLatency(), fetchServerLocationData(), fetchCfCdnCgiTrace()]);

  const city = serverLocationData[colo];
  const results = {
    server_location: `${city} (${colo})`,
    your_ip: `${ip} (${loc})`,
    latency: {
      min: ping[0].toFixed(2),
      max: ping[1].toFixed(2),
      average: ping[2].toFixed(2),
      median: ping[3].toFixed(2),
      jitter: ping[4].toFixed(2)
    },
    download_speeds: [],
    upload_speeds: []
  };

  const testDown1 = await measureDownload(101000, 10);
  results.download_speeds.push({ size: "100kB", speed: stats.median(testDown1).toFixed(2) });

  const testDown2 = await measureDownload(1001000, 8);
  results.download_speeds.push({ size: "1MB", speed: stats.median(testDown2).toFixed(2) });

  const testDown3 = await measureDownload(10001000, 6);
  results.download_speeds.push({ size: "10MB", speed: stats.median(testDown3).toFixed(2) });

  const testDown4 = await measureDownload(25001000, 4);
  results.download_speeds.push({ size: "25MB", speed: stats.median(testDown4).toFixed(2) });

  const testDown5 = await measureDownload(100001000, 1);
  results.download_speeds.push({ size: "100MB", speed: stats.median(testDown5).toFixed(2) });

  const downloadTests = [...testDown1, ...testDown2, ...testDown3, ...testDown4, ...testDown5];
  results.download_speeds.push({ size: "overall", speed: stats.quartile(downloadTests, 0.9).toFixed(2) });

  const testUp1 = await measureUpload(11000, 10);
  const testUp2 = await measureUpload(101000, 10);
  const testUp3 = await measureUpload(1001000, 8);
  results.upload_speeds.push({ size: "10kB", speed: stats.median(testUp1).toFixed(2) });
  results.upload_speeds.push({ size: "100kB", speed: stats.median(testUp2).toFixed(2) });
  results.upload_speeds.push({ size: "1MB", speed: stats.median(testUp3).toFixed(2) });

  const uploadTests = [...testUp1, ...testUp2, ...testUp3];
  results.upload_speeds.push({ size: "overall", speed: stats.quartile(uploadTests, 0.9).toFixed(2) });

  // Conditional output based on --json option
  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    logInfo("Server Location", results.server_location);
    logInfo("Your IP", results.your_ip);
    logLatency(results.latency);

    const downloadSpeeds = results.download_speeds.map(test => `${test.size}: ${test.speed} Mbps`);
    logDownloadSpeed(downloadSpeeds);

    const uploadSpeeds = results.upload_speeds.map(test => `${test.size}: ${test.speed} Mbps`);
    logUploadSpeed(uploadSpeeds);
  }
}

speedTest();
