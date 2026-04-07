#!/bin/bash
export PATH=/opt/homebrew/Caskroom/miniforge/base/bin:/opt/homebrew/bin:$PATH
cd "$(dirname "$0")"
exec node ./node_modules/vite/bin/vite.js --host --port "${PORT:-5173}"
