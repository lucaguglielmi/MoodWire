import "./styles.css";

export const metadata = {
  title: "MoodWire",
  description: "Bring curated Pinterest references into AI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
