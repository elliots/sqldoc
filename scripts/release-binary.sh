#!/usr/bin/env bash
set -euo pipefail

# Build all platform binaries, create archives, and publish a GitHub release
# with Homebrew tap update.
#
# Usage: bash scripts/release-binary.sh
#
# Requires: fossilize, gh (GitHub CLI)

cd "$(git rev-parse --show-toplevel)"

VERSION=$(node -e "console.log(require('./package.json').version)")
TAG="v${VERSION}"
DIST="dist"
RELEASE_DIR="$DIST/release"

echo "Releasing sqldoc ${TAG}..."

# -- 1. Build all platform binaries --
bash scripts/build-binary.sh linux-x64 linux-arm64 darwin-x64 darwin-arm64 win-x64

# -- 2. Create archives --
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

archive() {
  local src="$1" name="$2" format="${3:-tar.gz}"
  if [[ "$format" == "zip" ]]; then
    (cd "$(dirname "$src")" && zip -q "$OLDPWD/$RELEASE_DIR/${name}.zip" "$(basename "$src")")
  else
    tar -czf "$RELEASE_DIR/${name}.tar.gz" -C "$(dirname "$src")" "$(basename "$src")"
  fi
}

archive_binary() {
  local src="$1" staged="$2" name="$3" format="${4:-tar.gz}"
  if [[ ! -f "$src" ]]; then
    echo "Missing expected binary: $src" >&2
    exit 1
  fi
  cp "$src" "$staged"
  archive "$staged" "$name" "$format"
}

# Rename to just "sqldoc" (or sqldoc.exe) inside each archive
archive_binary "$DIST/sqldoc-linux-x64"    "$DIST/sqldoc"     "sqldoc_linux_amd64"
archive_binary "$DIST/sqldoc-linux-arm64"  "$DIST/sqldoc"     "sqldoc_linux_arm64"
archive_binary "$DIST/sqldoc-darwin-x64"   "$DIST/sqldoc"     "sqldoc_darwin_amd64"
archive_binary "$DIST/sqldoc-darwin-arm64" "$DIST/sqldoc"     "sqldoc_darwin_arm64"
archive_binary "$DIST/sqldoc-win-x64.exe"  "$DIST/sqldoc.exe" "sqldoc_windows_amd64" zip
rm -f "$DIST/sqldoc" "$DIST/sqldoc.exe"

# -- 3. Checksums --
(cd "$RELEASE_DIR" && shasum -a 256 *.tar.gz *.zip > checksums.txt)
echo "Checksums:"
cat "$RELEASE_DIR/checksums.txt"

# -- 4. GitHub release --
echo ""
echo "Creating GitHub release ${TAG}..."
gh release create "$TAG" "$RELEASE_DIR"/* \
  --title "$TAG" \
  --generate-notes

# -- 5. Update Homebrew tap --
echo ""
echo "Updating Homebrew tap..."
DARWIN_ARM64_SHA=$(grep darwin_arm64 "$RELEASE_DIR/checksums.txt" | awk '{print $1}')
DARWIN_AMD64_SHA=$(grep darwin_amd64 "$RELEASE_DIR/checksums.txt" | awk '{print $1}')
LINUX_ARM64_SHA=$(grep linux_arm64 "$RELEASE_DIR/checksums.txt" | awk '{print $1}')
LINUX_AMD64_SHA=$(grep linux_amd64 "$RELEASE_DIR/checksums.txt" | awk '{print $1}')

REPO_URL="https://github.com/elliots/sqldoc/releases/download/${TAG}"

FORMULA="class Sqldoc < Formula
  desc \"SQL documentation and code generation tool\"
  homepage \"https://github.com/elliots/sqldoc\"
  license \"\"
  version \"${VERSION}\"

  on_macos do
    if Hardware::CPU.arm?
      url \"${REPO_URL}/sqldoc_darwin_arm64.tar.gz\"
      sha256 \"${DARWIN_ARM64_SHA}\"
    else
      url \"${REPO_URL}/sqldoc_darwin_amd64.tar.gz\"
      sha256 \"${DARWIN_AMD64_SHA}\"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url \"${REPO_URL}/sqldoc_linux_arm64.tar.gz\"
      sha256 \"${LINUX_ARM64_SHA}\"
    else
      url \"${REPO_URL}/sqldoc_linux_amd64.tar.gz\"
      sha256 \"${LINUX_AMD64_SHA}\"
    end
  end

  def install
    bin.install \"sqldoc\"
  end

  test do
    system \"\#{bin}/sqldoc\", \"--version\"
  end
end"

# Clone/update the tap repo and push the formula
BREW_REPO=$(mktemp -d)
git clone "https://github.com/elliots/homebrew-sqldoc.git" "$BREW_REPO" --depth 1
echo "$FORMULA" > "$BREW_REPO/sqldoc.rb"
(cd "$BREW_REPO" && git add -A && git commit -m "sqldoc ${VERSION}" && git push)
rm -rf "$BREW_REPO"

echo ""
echo "Released sqldoc ${TAG}!"
