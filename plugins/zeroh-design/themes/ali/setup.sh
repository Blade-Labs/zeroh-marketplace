#!/bin/bash
set -e

REPO="https://raw.githubusercontent.com/Blade-Labs/ui-design-skill/main"
THEME="ali"

echo "Setting up Ali design system..."

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

# Write layout.tsx with Crimson Pro
cat > src/app/layout.tsx << 'EOF'
import type { Metadata } from "next";
import { Crimson_Pro } from "next/font/google";
import "./globals.css";

const crimsonPro = Crimson_Pro({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-crimson",
});

export const metadata: Metadata = {
  title: "My App",
  description: "Built with the Ali design system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${crimsonPro.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
EOF

echo ""
echo "Done. Run: claude"
