#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

npx expo prebuild --platform android --no-install
cd android
./gradlew assembleRelease

echo
echo "APK created at:"
echo "$(pwd)/app/build/outputs/apk/release/app-release.apk"
