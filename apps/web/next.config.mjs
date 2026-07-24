const verificationDistDir = process.env.RAPIDAPPLY_NEXT_DIST_DIR?.trim();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@rapidapply/contracts"],
  // A production verification build can run beside the local dev server
  // without replacing its hot-reload manifest or server chunks. Deployment
  // builds keep Next's normal `.next` default.
  ...(verificationDistDir ? { distDir: verificationDistDir } : {}),
};

export default nextConfig;
