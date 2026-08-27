#!/bin/bash
echo "Stopping all Interview Coder processes..."
pkill -9 -f 'electron ./dist-electron/main.js' 2>/dev/null || true
pkill -9 -f 'interview-coder' 2>/dev/null || true
echo "Done. All instances stopped."
