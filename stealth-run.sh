#!/bin/bash
echo "=== Interview Coder - Invisible Edition (No Paywall) ==="
echo
echo "IMPORTANT: This app is designed to be INVISIBLE by default!"
echo "Use the keyboard shortcuts to control it:"
echo
echo "- Toggle Visibility: Cmd+B"
echo "- Take Screenshot: Cmd+H"
echo "- Process Screenshots: Cmd+Enter"
echo "- Move Window: Cmd+Arrows (Left/Right/Up/Down)"
echo "- Adjust Opacity: Cmd+[ (decrease) / Cmd+] (increase)"
echo "- Reset View: Cmd+R"
echo "- Quit App: Cmd+Q"
echo
echo "When you press Cmd+B, the window will toggle between visible and invisible."
echo "If movement shortcuts aren't working, try making the window visible first with Cmd+B."
echo

# Navigate to script directory
cd "$(dirname "$0")"

# Create OS-appropriate directories
if [[ "$OSTYPE" == "darwin"* ]]; then
  mkdir -p ~/Library/Application\ Support/interview-coder-v1/{temp,cache,screenshots,extra_screenshots}
else
  mkdir -p ~/.config/interview-coder-v1/{temp,cache,screenshots,extra_screenshots}
fi

echo "=== Step 2: Cleaning previous builds... ==="
echo "Removing old build files to ensure a fresh start..."
rm -rf dist dist-electron
rm -f .env

echo "=== Step 3: Building application... ==="
echo "This may take a moment..."
npm run build

echo "=== Step 4: Launching in stealth mode... ==="
echo "Remember: Press Ctrl+B to toggle visibility!"
echo "Use Ctrl+[ and Ctrl+] to adjust opacity."
echo "Press Ctrl+Q in the app or Ctrl+C in this terminal to stop."
echo

export NODE_ENV=production
# Run electron in foreground so Ctrl+C will gracefully stop the app
npx electron ./dist-electron/main.js

