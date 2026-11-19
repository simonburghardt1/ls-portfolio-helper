/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // Portfolio Overview was merged into the Portfolios page
      { source: "/portfolio/overview", destination: "/portfolio", permanent: false },
      // High Beta Momentum moved into the normal Basket detail page
      { source: "/portfolio/markets/high-beta-momentum", destination: "/portfolio/markets/baskets/high-beta-momentum", permanent: false },
    ];
  },
};

export default nextConfig;
