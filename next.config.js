/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "tesseract.js",
      "pdfjs-dist",
      "pdf-parse",
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Prevent webpack from bundling native addons and ESM-only packages
      const externals = ["pdfjs-dist", "tesseract.js", "pdf-parse"];
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        ({ request }, callback) => {
          if (externals.some((pkg) => request === pkg || request?.startsWith(pkg + "/"))) {
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
