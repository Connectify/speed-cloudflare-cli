module.exports.magenta = (...args) => `\u001b[35m${args.join(" ")}\u001b[0m`;
module.exports.bold = (...args) => `\u001b[1m${args.join(" ")}\u001b[0m`;
module.exports.yellow = (...args) => `\u001b[33m${args.join(" ")}\u001b[0m`;
module.exports.green = (...args) => `\u001b[32m${args.join(" ")}\u001b[0m`;
module.exports.blue = (...args) => `\u001b[34m${args.join(" ")}\u001b[0m`;
