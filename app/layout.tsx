import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'UBO Mapper',
  description: 'List who owns what and get an ownership chart you can download as PNG or PDF',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
