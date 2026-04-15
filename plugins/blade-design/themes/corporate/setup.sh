#!/bin/bash
set -e

REPO="https://raw.githubusercontent.com/Blade-Labs/ui-design-skill/main"
THEME="grc"

echo "Setting up Blade Labs GRC design system..."

# Install shadcn
npx shadcn@latest init -d

# Add components
npx shadcn@latest add button card input badge table dialog

# Download design system files
mkdir -p docs
curl -s "$REPO/references/$THEME/DESIGN.md" -o docs/DESIGN.md
curl -s "$REPO/references/core/PRINCIPLES.md" -o docs/PRINCIPLES.md
curl -s "$REPO/references/$THEME/globals.css" -o src/app/globals.css
curl -s "$REPO/themes/$THEME/CLAUDE.md" -o CLAUDE.md

# Write layout.tsx with DM Sans
cat > src/app/layout.tsx << 'EOF'
import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "My App",
  description: "Built with the Blade Labs GRC design system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
EOF

echo ""
echo "Done. Run: claude"
