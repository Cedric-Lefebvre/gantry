#!/bin/bash

# Generate Tauri icons from a source image
# Usage: ./generate-icons.sh [source_image]
# Default source: unnamed.jpg in the same directory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="${1:-$SCRIPT_DIR/unnamed.jpg}"
ICONS_DIR="$SCRIPT_DIR/../src-tauri/icons"

if [ ! -f "$SOURCE" ]; then
    echo "Error: Source image not found: $SOURCE"
    exit 1
fi

echo "Generating icons from: $SOURCE"
echo "Output directory: $ICONS_DIR"

# Check for ImageMagick
if ! command -v convert &> /dev/null; then
    echo "Error: ImageMagick is required. Install with: sudo apt install imagemagick"
    exit 1
fi

# Create icons directory if it doesn't exist
mkdir -p "$ICONS_DIR"

# Standard PNG sizes for Tauri (must be RGBA format)
echo "Generating PNG icons..."
convert "$SOURCE" -resize 32x32 -type TrueColorAlpha -define png:color-type=6 "$ICONS_DIR/32x32.png"
convert "$SOURCE" -resize 64x64 -type TrueColorAlpha -define png:color-type=6 "$ICONS_DIR/64x64.png"
convert "$SOURCE" -resize 128x128 -type TrueColorAlpha -define png:color-type=6 "$ICONS_DIR/128x128.png"
convert "$SOURCE" -resize 256x256 -type TrueColorAlpha -define png:color-type=6 "$ICONS_DIR/128x128@2x.png"
convert "$SOURCE" -resize 512x512 -type TrueColorAlpha -define png:color-type=6 "$ICONS_DIR/icon.png"

# Windows icon (ICO) - multiple sizes embedded
echo "Generating Windows icon..."
convert "$SOURCE" -resize 256x256 -define icon:auto-resize=256,128,64,48,32,16 "$ICONS_DIR/icon.ico"

# macOS icon (ICNS)
echo "Generating macOS icon..."
if command -v png2icns &> /dev/null; then
    convert "$SOURCE" -resize 1024x1024 "/tmp/icon_1024.png"
    png2icns "$ICONS_DIR/icon.icns" "/tmp/icon_1024.png"
    rm "/tmp/icon_1024.png"
elif command -v icnsutil &> /dev/null; then
    convert "$SOURCE" -resize 1024x1024 "/tmp/icon_1024.png"
    icnsutil c "$ICONS_DIR/icon.icns" "/tmp/icon_1024.png"
    rm "/tmp/icon_1024.png"
else
    echo "Warning: png2icns/icnsutil not found, creating ICNS with ImageMagick (may not work on all macOS versions)"
    convert "$SOURCE" -resize 512x512 "$ICONS_DIR/icon.icns"
fi

# Windows Store logos (must be RGBA format)
echo "Generating Windows Store logos..."
convert "$SOURCE" -resize 30x30 -type TrueColorAlpha -define png:color-type=6 "$ICONS_DIR/Square30x30Logo.png"
convert "$SOURCE" -resize 44x44 -type TrueColorAlpha -define png:color-type=6 "$ICONS_DIR/Square44x44Logo.png"
convert "$SOURCE" -resize 71x71 -type TrueColorAlpha -define png:color-type=6 "$ICONS_DIR/Square71x71Logo.png"
convert "$SOURCE" -resize 89x89 -type TrueColorAlpha -define png:color-type=6 "$ICONS_DIR/Square89x89Logo.png"
convert "$SOURCE" -resize 107x107 -type TrueColorAlpha -define png:color-type=6 "$ICONS_DIR/Square107x107Logo.png"
convert "$SOURCE" -resize 142x142 -type TrueColorAlpha -define png:color-type=6 "$ICONS_DIR/Square142x142Logo.png"
convert "$SOURCE" -resize 150x150 -type TrueColorAlpha -define png:color-type=6 "$ICONS_DIR/Square150x150Logo.png"
convert "$SOURCE" -resize 284x284 -type TrueColorAlpha -define png:color-type=6 "$ICONS_DIR/Square284x284Logo.png"
convert "$SOURCE" -resize 310x310 -type TrueColorAlpha -define png:color-type=6 "$ICONS_DIR/Square310x310Logo.png"
convert "$SOURCE" -resize 50x50 -type TrueColorAlpha -define png:color-type=6 "$ICONS_DIR/StoreLogo.png"

echo "Done! Icons generated in $ICONS_DIR"
