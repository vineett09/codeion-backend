const isProd = process.env.NODE_ENV === "production";

const logger = {
  log: (...args) => {
    if (!isProd) console.log(...args);
  },
  warn: (...args) => {
    if (!isProd) console.warn(...args);
  },
  error: (...args) => {
    if (!isProd) console.error(...args);
  },
};

module.exports = logger;
