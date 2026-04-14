/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "tesseract.js",
      // pdf-parse v1 is CJS — kept as external so require() works correctly.
      // pdfjs-dist is ESM-only — NOT listed here; it is imported via
      // `/* webpackIgnore: true */` dynamic import so Node.js handles it natively
      // without webpack emitting a broken `require()` call.
      "pdf-parse",
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Only externalize CJS-compatible packages.
      // pdfjs-dist is ESM-only — externalizing it as `commonjs` causes
      // ERR_REQUIRE_ESM at runtime. It is handled via webpackIgnore instead.
      const cjsExternals = ["tesseract.js", "pdf-parse"];
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        ({ request }, callback) => {
          if (cjsExternals.some((pkg) => request === pkg || request?.startsWith(pkg + "/"))) {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        },
      ];
    }
    return config;
  },
};
module.exports = nextConfig;
