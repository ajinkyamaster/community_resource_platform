import './globals.css';

export const metadata = {
  title: 'Community Resource Platform',
  description: 'Private group resource sharing'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}