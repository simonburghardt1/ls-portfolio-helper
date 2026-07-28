import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "Trading Platform",
  description: "Macro Dashboard · Portfolio Management · Track Record",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
