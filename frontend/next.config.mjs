/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // Portfolio Overview was merged into the Portfolios page
      { source: "/portfolio/overview", destination: "/portfolio", permanent: false },
    ];
  },
};

export default nextConfig;
