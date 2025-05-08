#!/bin/bash

set -e

MAX_SIZE_MB=100
MAX_SIZE_BYTES=$((MAX_SIZE_MB * 1024 * 1024))

echo "🔍 Searching for files larger than $MAX_SIZE_MB MB in current Git working directory..."

# Ensure git-filter-repo is installed
if ! command -v git-filter-repo &>/dev/null; then
  echo "❌ git-filter-repo not found. Install it with:"
  echo "   brew install git-filter-repo"
  exit 1
fi

# Check if we're inside a Git repo
if [ ! -d .git ]; then
  echo "❌ This is not a Git repository."
  exit 1
fi

# Find large files (excluding .git directory)
LARGE_FILES=$(find . -type f -size +${MAX_SIZE_MB}M -not -path "./.git/*")

if [ -z "$LARGE_FILES" ]; then
  echo "✅ No files larger than $MAX_SIZE_MB MB found."
  exit 0
fi

echo "🗑 Found large files:"
echo "$LARGE_FILES"
echo ""

# Confirm before proceeding
read -p "⚠️  Remove these files from Git history and ignore them? (y/n) " CONFIRM
[[ $CONFIRM != "y" ]] && echo "❌ Aborted." && exit 1

# Remove large files from git history
for FILE in $LARGE_FILES; do
  CLEAN_PATH="${FILE#./}"  # Strip leading './'
  echo "⏳ Removing $CLEAN_PATH from Git history..."
  git filter-repo --force --path "$CLEAN_PATH" --invert-paths
done

# Add cleaned paths to .gitignore
for FILE in $LARGE_FILES; do
  CLEAN_PATH="${FILE#./}"  # Strip leading './' for .gitignore too
  if ! grep -Fxq "$CLEAN_PATH" .gitignore; then
    echo "$CLEAN_PATH" >> .gitignore
    echo "➕ Added $CLEAN_PATH to .gitignore"
  fi
done

# Commit .gitignore update
git add .gitignore
git commit -m "🚫 Removed and ignored files > ${MAX_SIZE_MB}MB"

# Push clean repo back up
echo "🚀 Force pushing cleaned repo to origin/main..."
git push origin main --force

echo "✅ Cleanup complete!"
